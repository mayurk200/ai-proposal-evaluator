import pytest
from unittest.mock import patch, MagicMock
from app.services.extraction.table_extractor import (
    extract_tables_from_pdf,
    extract_tables_from_docx,
    extract_tables_from_pptx,
    extract_tables_from_file,
)
from app.models.schemas import ExtractedTable

def test_extract_tables_from_pdf():
    with patch("fitz.open") as mock_open:
        mock_doc = MagicMock()
        mock_open.return_value = mock_doc
        
        mock_page = MagicMock()
        mock_doc.__len__.return_value = 1
        mock_doc.__getitem__.return_value = mock_page
        
        mock_table = MagicMock()
        mock_table.extract.return_value = [
            ["Col1", "Col2"],
            ["Val1", "Val2"]
        ]
        mock_page.find_tables.return_value = [mock_table]
        
        tables = extract_tables_from_pdf(file_path="test.pdf")
        assert len(tables) == 1
        assert tables[0].headers == ["Col1", "Col2"]
        assert tables[0].rows == [["Val1", "Val2"]]
        assert tables[0].page_number == 1
        
        # Test bytes
        tables = extract_tables_from_pdf(file_bytes=b"fake")
        assert len(tables) == 1

def test_extract_tables_from_pdf_exceptions():
    with patch("fitz.open") as mock_open:
        mock_doc = MagicMock()
        mock_open.return_value = mock_doc
        mock_page = MagicMock()
        mock_doc.__len__.return_value = 1
        mock_doc.__getitem__.return_value = mock_page
        
        # Test find_tables exception
        mock_page.find_tables.side_effect = Exception("Test error")
        tables = extract_tables_from_pdf(file_path="test.pdf")
        assert len(tables) == 0

def test_extract_tables_from_docx():
    with patch("docx.Document") as mock_doc_class:
        mock_doc = MagicMock()
        mock_doc_class.return_value = mock_doc
        
        mock_table = MagicMock()
        row1 = MagicMock()
        cell1 = MagicMock(); cell1.text = "Header1"
        cell2 = MagicMock(); cell2.text = "Header2"
        row1.cells = [cell1, cell2]
        
        row2 = MagicMock()
        cell3 = MagicMock(); cell3.text = "Data1"
        cell4 = MagicMock(); cell4.text = "Data2"
        row2.cells = [cell3, cell4]
        
        mock_table.rows = [row1, row2]
        mock_doc.tables = [mock_table]
        
        tables = extract_tables_from_docx(file_path="test.docx")
        assert len(tables) == 1
        assert tables[0].headers == ["Header1", "Header2"]
        assert tables[0].rows == [["Data1", "Data2"]]

        # Test bytes
        tables = extract_tables_from_docx(file_bytes=b"fake")
        assert len(tables) == 1

def test_extract_tables_from_pptx():
    with patch("pptx.Presentation") as mock_pres_class:
        mock_pres = MagicMock()
        mock_pres_class.return_value = mock_pres
        
        mock_slide = MagicMock()
        mock_shape = MagicMock()
        mock_shape.has_table = True
        
        mock_table = MagicMock()
        row1 = MagicMock()
        cell1 = MagicMock(); cell1.text = "H1"
        cell2 = MagicMock(); cell2.text = "H2"
        row1.cells = [cell1, cell2]
        
        row2 = MagicMock()
        cell3 = MagicMock(); cell3.text = "D1"
        cell4 = MagicMock(); cell4.text = "D2"
        row2.cells = [cell3, cell4]
        
        mock_table.rows = [row1, row2]
        mock_shape.table = mock_table
        mock_slide.shapes = [mock_shape]
        mock_pres.slides = [mock_slide]
        
        tables = extract_tables_from_pptx(file_path="test.pptx")
        assert len(tables) == 1
        assert tables[0].headers == ["H1", "H2"]
        assert tables[0].rows == [["D1", "D2"]]

        # Test bytes
        tables = extract_tables_from_pptx(file_bytes=b"fake")
        assert len(tables) == 1

def test_extract_tables_from_file_dispatch():
    with patch("app.services.extraction.table_extractor.extract_tables_from_pdf") as mock_pdf:
        extract_tables_from_file(filename="test.pdf")
        mock_pdf.assert_called_once()
        
    with patch("app.services.extraction.table_extractor.extract_tables_from_docx") as mock_docx:
        extract_tables_from_file(filename="test.docx")
        mock_docx.assert_called_once()
        
    with patch("app.services.extraction.table_extractor.extract_tables_from_pptx") as mock_pptx:
        extract_tables_from_file(filename="test.pptx")
        mock_pptx.assert_called_once()
        
    assert extract_tables_from_file(filename="test.txt") == []
