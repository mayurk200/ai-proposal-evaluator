"""
Export an evaluation report to PDF.

Requirement (g): "generated result can also be exported to pdf".

The export deliberately carries the *evidence*, not just the numbers. A PDF that says
"Pilot Design: 85/100" is a claim; one that says "85/100, because the document states
'1,000 farmers across Maharashtra's cotton belt, covering approximately 2,500 acres'"
is a defensible record — which is the whole point of requirement (b), and the reason an
evaluator can hand this to an applicant or an auditor.

Unevidenced parameters are printed as "not addressed", never as zero, so the PDF cannot
misrepresent a silent proposal as a bad one.
"""

from __future__ import annotations

import io
from datetime import datetime
from typing import Any, Optional

from reportlab.lib import colors
from reportlab.lib.enums import TA_JUSTIFY
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    HRFlowable,
    KeepTogether,
    ListFlowable,
    ListItem,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from app.utils.logging import get_logger

logger = get_logger(__name__)

INK = colors.HexColor("#1a1a1a")
MUTED = colors.HexColor("#666666")
RULE = colors.HexColor("#d8d8d8")
BAND = colors.HexColor("#f4f4f2")
GOOD = colors.HexColor("#2e7d32")
WARN = colors.HexColor("#b26a00")
BAD = colors.HexColor("#c62828")


def _score_colour(score: Optional[float]) -> colors.Color:
    if score is None:
        return MUTED
    if score >= 70:
        return GOOD
    if score >= 45:
        return WARN
    return BAD


def _styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle(
            "title", parent=base["Title"], fontSize=18, leading=22, textColor=INK,
            spaceAfter=2,
        ),
        "subtitle": ParagraphStyle(
            "subtitle", parent=base["Normal"], fontSize=9.5, textColor=MUTED,
            spaceAfter=10,
        ),
        "h2": ParagraphStyle(
            "h2", parent=base["Heading2"], fontSize=12.5, leading=15, textColor=INK,
            spaceBefore=12, spaceAfter=5,
        ),
        "h3": ParagraphStyle(
            "h3", parent=base["Heading3"], fontSize=10.5, leading=13, textColor=INK,
            spaceBefore=8, spaceAfter=3,
        ),
        "body": ParagraphStyle(
            "body", parent=base["Normal"], fontSize=9.5, leading=13.5, textColor=INK,
            alignment=TA_JUSTIFY, spaceAfter=4,
        ),
        "muted": ParagraphStyle(
            "muted", parent=base["Normal"], fontSize=8.5, leading=11, textColor=MUTED,
        ),
        # Citations are set apart and indented so a reader can see at a glance which
        # words came from the applicant and which are ours.
        "quote": ParagraphStyle(
            "quote", parent=base["Normal"], fontSize=8.5, leading=11.5,
            textColor=colors.HexColor("#333333"), leftIndent=10, rightIndent=6,
            fontName="Helvetica-Oblique", spaceBefore=2, spaceAfter=2,
            borderPadding=(3, 3, 3, 6), backColor=BAND,
        ),
    }


def _esc(text: Any) -> str:
    """ReportLab parses its own mini-markup, so raw text must be escaped."""
    return (
        str(text or "")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def format_score(score: Optional[float]) -> str:
    """
    How a parameter score is printed.

    `None` means the proposal never addressed the parameter, and it must never be
    rendered as "0.0". This PDF is what gets handed to an applicant or an auditor —
    printing a zero would permanently misrepresent a silent document as a bad one, in a
    file that outlives the conversation that could have corrected it.
    """
    return f"{score:.1f}" if score is not None else "Not addressed"


def _ordered_breakdown(breakdown: dict[str, dict]) -> dict[str, dict]:
    """
    Sort parameters into the canonical AIAIC order.

    The agents run concurrently, so the dict's insertion order is really their
    *completion* order — meaning the same proposal, exported twice, produced tables with
    the rows in different positions. A funding record should not shuffle itself.
    """
    from app.agents.parameters import WEIGHTS

    order = list(WEIGHTS)
    return dict(
        sorted(
            breakdown.items(),
            key=lambda kv: order.index(kv[0]) if kv[0] in order else len(order),
        )
    )


def build_evaluation_pdf(
    *,
    evaluation: dict,
    proposal: dict,
    decision: Optional[dict] = None,
) -> bytes:
    """Render one evaluation report to PDF bytes."""
    styles = _styles()
    buffer = io.BytesIO()

    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=16 * mm,
        bottomMargin=16 * mm,
        title=f"Evaluation — {proposal.get('title') or proposal.get('filename')}",
        author="AgriEval",
    )

    report = evaluation.get("report") or {}
    final = report.get("evaluation") or {}
    story: list[Any] = []

    # ------------------------------------------------------------------ header
    story.append(Paragraph(_esc(proposal.get("title") or proposal.get("filename")), styles["title"]))

    meta = [
        proposal.get("company_name") or "Company not identified",
        proposal.get("category_label") or "Uncategorised",
        f"Evaluated {(evaluation.get('completed_at') or evaluation.get('created_at') or '')[:10]}",
    ]
    story.append(Paragraph(" &nbsp;·&nbsp; ".join(_esc(m) for m in meta), styles["subtitle"]))
    story.append(HRFlowable(width="100%", color=RULE, spaceAfter=8))

    # --------------------------------------------------------------- verdict
    score = final.get("overall_score", 0.0)
    coverage = final.get("evidence_coverage", 0.0)

    verdict = Table(
        [
            [
                Paragraph(f"<b>{score:.1f}</b><font size=9>/100</font>", ParagraphStyle(
                    "score", fontSize=22, leading=24, textColor=_score_colour(score),
                )),
                Paragraph(
                    f"<b>{_esc(final.get('recommendation'))}</b><br/>"
                    f"<font size=8 color='#666666'>Risk: {_esc(final.get('risk_level'))}"
                    f" &nbsp;·&nbsp; Evidence coverage: {coverage:.0%}</font>",
                    styles["body"],
                ),
            ]
        ],
        colWidths=[35 * mm, None],
    )
    verdict.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), BAND),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 10),
                ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ]
        )
    )
    story.append(verdict)

    # The funding decision is the single most consequential fact on this page.
    if decision:
        label = {
            "approved": "APPROVED",
            "selected_for_funding": "SELECTED FOR FUNDING",
            "rejected": "REJECTED",
            "unselected": "DE-SELECTED",
        }.get(decision.get("decision", ""), decision.get("decision", "").upper())

        story.append(Spacer(1, 5))
        story.append(
            Paragraph(
                f"<b>Decision: {_esc(label)}</b> &nbsp;·&nbsp; "
                f"{_esc((decision.get('decided_at') or '')[:10])}"
                + (f"<br/>{_esc(decision.get('notes'))}" if decision.get("notes") else ""),
                styles["muted"],
            )
        )

    # --------------------------------------------------------------- summary
    if final.get("summary"):
        story.append(Paragraph("Summary", styles["h2"]))
        story.append(Paragraph(_esc(final["summary"]), styles["body"]))

    # ------------------------------------------------- parameter score table
    story.append(Paragraph("Parameter Scores", styles["h2"]))

    rows = [["Parameter", "Weight", "Score", "Evidence"]]

    # Present the parameters in the canonical AIAIC order, not in whatever order the
    # dict happens to iterate. Agents run concurrently, so insertion order is really
    # completion order — which meant the table's row order changed between runs of the
    # same proposal.
    breakdown = _ordered_breakdown(final.get("parameter_breakdown") or {})

    for param in breakdown.values():
        rows.append(
            [
                param.get("parameter_name", ""),
                f"{param.get('weight', 0) * 100:.0f}%",
                format_score(param.get("parameter_score")),
                f"{param.get('evidence_coverage', 0):.0%}",
            ]
        )

    table = Table(rows, colWidths=[None, 20 * mm, 28 * mm, 22 * mm], repeatRows=1)
    style = [
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 8.5),
        ("BACKGROUND", (0, 0), (-1, 0), BAND),
        ("TEXTCOLOR", (0, 0), (-1, 0), INK),
        ("LINEBELOW", (0, 0), (-1, -1), 0.4, RULE),
        ("ALIGN", (1, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]
    for i, param in enumerate(breakdown.values(), start=1):
        style.append(("TEXTCOLOR", (2, i), (2, i), _score_colour(param.get("parameter_score"))))
    table.setStyle(TableStyle(style))
    story.append(table)

    if final.get("unevidenced_parameters"):
        story.append(Spacer(1, 4))
        story.append(
            Paragraph(
                "<b>Not addressed by the proposal:</b> "
                + _esc(", ".join(final["unevidenced_parameters"]))
                + ". These are excluded from the weighted score rather than counted as "
                "zero — the proposal is silent on them, which is not the same as "
                "answering them poorly.",
                styles["muted"],
            )
        )

    # ------------------------------------------------------------------ SWOT
    swot = final.get("swot_analysis") or {}
    if swot.get("narrative") or any(
        swot.get(k) for k in ("strengths", "weaknesses", "opportunities", "threats")
    ):
        story.append(Paragraph("SWOT Analysis", styles["h2"]))

        if swot.get("narrative"):
            story.append(Paragraph(_esc(swot["narrative"]), styles["body"]))
            story.append(Spacer(1, 4))

        quadrants = [
            ("Strengths", swot.get("strengths") or []),
            ("Weaknesses", swot.get("weaknesses") or []),
            ("Opportunities", swot.get("opportunities") or []),
            ("Threats", swot.get("threats") or []),
        ]
        cells = []
        for label, items in quadrants:
            body = "<br/>".join(f"• {_esc(i)}" for i in items) or "<i>None recorded</i>"
            cells.append(
                Paragraph(f"<b>{label}</b><br/><font size=8>{body}</font>", styles["muted"])
            )

        grid = Table([[cells[0], cells[1]], [cells[2], cells[3]]], colWidths=[None, None])
        grid.setStyle(
            TableStyle(
                [
                    ("BOX", (0, 0), (-1, -1), 0.4, RULE),
                    ("INNERGRID", (0, 0), (-1, -1), 0.4, RULE),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 7),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 7),
                    ("TOPPADDING", (0, 0), (-1, -1), 6),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ]
            )
        )
        story.append(grid)

    # ------------------------------------------------------- action items
    if final.get("key_action_items"):
        story.append(Paragraph("Required Actions", styles["h2"]))
        story.append(
            ListFlowable(
                [
                    ListItem(Paragraph(_esc(item), styles["body"]), leftIndent=12)
                    for item in final["key_action_items"]
                ],
                bulletType="1",
                start="1",
            )
        )

    if final.get("unsupported_claims"):
        story.append(Paragraph("Claims Not Supported by Evidence", styles["h3"]))
        for claim in final["unsupported_claims"]:
            story.append(Paragraph(f"• {_esc(claim)}", styles["muted"]))

    # ------------------------------------------------- evidence appendix
    story.append(PageBreak())
    story.append(Paragraph("Evidence", styles["h2"]))
    story.append(
        Paragraph(
            "Every score below is followed by the verbatim text from the proposal that "
            "produced it. Quotes that could not be located in the source document were "
            "discarded and did not contribute to any score.",
            styles["muted"],
        )
    )
    story.append(Spacer(1, 6))

    for param in breakdown.values():
        raw = param.get("parameter_score")
        heading = (
            f"{param.get('parameter_name')} — "
            f"{f'{raw:.1f}/100' if raw is not None else 'not addressed'}"
        )
        block: list[Any] = [Paragraph(_esc(heading), styles["h3"])]

        for sq in param.get("sub_questions") or []:
            if sq.get("evidence_found") and sq.get("score") is not None:
                block.append(
                    Paragraph(
                        f"<b>{sq['score']:.1f}/10</b> &nbsp;{_esc(sq.get('question'))}",
                        styles["body"],
                    )
                )
                for citation in sq.get("citations") or []:
                    section = citation.get("section")
                    suffix = f" <font color='#888888'>[{_esc(section)}]</font>" if section else ""
                    block.append(
                        Paragraph(f"“{_esc(citation.get('quote'))}”{suffix}", styles["quote"])
                    )
                if sq.get("justification"):
                    block.append(Paragraph(_esc(sq["justification"]), styles["muted"]))
            else:
                block.append(
                    Paragraph(
                        f"<b><font color='#666666'>Not addressed</font></b> &nbsp;"
                        f"{_esc(sq.get('question'))}",
                        styles["body"],
                    )
                )
            block.append(Spacer(1, 3))

        if param.get("red_flags"):
            block.append(
                Paragraph(
                    "<b>Red flags:</b> " + _esc("; ".join(param["red_flags"])),
                    styles["muted"],
                )
            )

        # Keep a parameter's heading with at least the start of its evidence, so a page
        # break never orphans a title.
        story.append(KeepTogether(block[:3]))
        story.extend(block[3:])
        story.append(Spacer(1, 6))

    def _footer(canvas, doc_):
        canvas.saveState()
        canvas.setFont("Helvetica", 7.5)
        canvas.setFillColor(MUTED)
        canvas.drawString(
            18 * mm,
            10 * mm,
            f"AgriEval · {proposal.get('filename', '')[:60]} · "
            f"generated {datetime.now().strftime('%Y-%m-%d %H:%M')}",
        )
        canvas.drawRightString(A4[0] - 18 * mm, 10 * mm, f"Page {doc_.page}")
        canvas.restoreState()

    doc.build(story, onFirstPage=_footer, onLaterPages=_footer)

    pdf = buffer.getvalue()
    buffer.close()

    logger.info(
        "evaluation_pdf_generated",
        evaluation_id=evaluation.get("id"),
        bytes=len(pdf),
    )
    return pdf
