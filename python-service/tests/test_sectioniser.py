"""
Sectioning — requirement (h): split the document so each agent gets only its part.
"""

import pytest

from app.services.processing.sectioniser import (
    SCOREABLE_SECTION_KEYS,
    classify_by_keywords,
    scoreable_sections,
    sectionise,
    sections_from_json,
    sections_to_json,
    split_into_blocks,
)


DOC = """Cover page for the proposal.

## Problem Statements
Smallholder farmers in Vidarbha lose up to 30% of their cotton crop to pink bollworm.

## Revenue Model
We charge a subscription of Rs 200 per acre per season, paid by the insurer.

## Founders Background
Our CEO holds an MBA and has 18 years of experience in rural lending.

## DPDP Compliance
Farmer data is collected under explicit consent and stored in-country.

## Email
contact@example.com
"""


class TestBlockSplitting:
    def test_splits_on_heading_markers(self):
        blocks = split_into_blocks(DOC)
        headings = [b.heading for b in blocks if b.heading]
        assert "Problem Statements" in headings
        assert "Revenue Model" in headings

    def test_preamble_before_the_first_heading_is_kept(self):
        """The cover page and abstract are real content and must not be dropped."""
        blocks = split_into_blocks(DOC)
        assert any(b.heading == "" and "Cover page" in b.text for b in blocks)

    def test_document_with_no_headings_becomes_one_block(self):
        blocks = split_into_blocks("Just some flat text with no structure at all.")
        assert len(blocks) == 1
        assert blocks[0].heading == ""


class TestKeywordClassification:
    @pytest.mark.parametrize(
        "heading,expected",
        [
            ("Problem Statements", "problem"),
            ("Revenue Model", "business_model"),
            ("Founders Background", "team"),
            ("DPDP Compliance", "compliance"),
            ("Workplan & Milestones", "pilot"),
            ("Unit Economics", "financial"),
        ],
    )
    def test_heading_keywords_route_correctly(self, heading, expected):
        from app.services.processing.sectioniser import Block

        block = Block(heading=heading, text="Some body text about this topic.", start=0, end=0)
        key, _confidence = classify_by_keywords(block)
        assert key == expected

    def test_word_boundaries_are_respected(self):
        """
        The old filter used naive substring matching, so "ip" matched inside "DIPP",
        "equipment" and "recipient" and the compliance agent was fed unrelated text.
        """
        from app.services.processing.sectioniser import Block

        block = Block(
            heading="Equipment Recipient DIPP Number",
            text="Our DIPP registration number is 12345.",
            start=0,
            end=0,
        )
        key, _ = classify_by_keywords(block)
        # Must not be routed on a spurious substring hit.
        assert key in ("identity", "", "solution")


class TestSectionise:
    @pytest.mark.asyncio
    async def test_finds_the_sections_the_document_contains(self):
        sections = await sectionise(DOC)

        assert "problem" in sections
        assert "business_model" in sections
        assert "team" in sections
        assert "compliance" in sections
        assert "Smallholder farmers" in sections["problem"].text

    @pytest.mark.asyncio
    async def test_absent_section_is_absent_not_empty(self):
        """
        An agent must be able to tell "the document has no financial section" from
        "the financial section is empty". That distinction is what lets it report
        'insufficient evidence' instead of inventing a low score.
        """
        sections = await sectionise("## Problem\nFarmers lose crops to pests every year.")
        assert "financial" not in sections

    @pytest.mark.asyncio
    async def test_contact_details_never_reach_a_scoring_agent(self):
        """
        An applicant's email address is not evidence for or against their pilot design.
        Identity fields are captured for metadata and excluded from agent dispatch.
        """
        sections = await sectionise(DOC)
        scoreable = scoreable_sections(sections)

        assert "identity" not in SCOREABLE_SECTION_KEYS
        assert "identity" not in scoreable
        assert all(key in SCOREABLE_SECTION_KEYS for key in scoreable)

    @pytest.mark.asyncio
    async def test_empty_document_yields_no_sections(self):
        assert await sectionise("") == {}


class TestSerialization:
    @pytest.mark.asyncio
    async def test_sections_round_trip_through_jsonb(self):
        """
        Sections are persisted at ingestion so re-evaluating a stored idea never
        re-reads the source document.
        """
        sections = await sectionise(DOC)
        payload = sections_to_json(sections)
        restored = sections_from_json(payload)

        assert set(restored) == set(sections)
        assert "Smallholder farmers" in restored["problem"]
