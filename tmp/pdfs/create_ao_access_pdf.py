from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import landscape, letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "output" / "pdf" / "AO-Website-Functions-Access.pdf"
OUTPUT.parent.mkdir(parents=True, exist_ok=True)

NAVY = colors.HexColor("#071A35")
BLUE = colors.HexColor("#075FC6")
MID_BLUE = colors.HexColor("#EAF3FD")
PALE_BLUE = colors.HexColor("#F5F9FD")
LIME = colors.HexColor("#D2F42B")
INK = colors.HexColor("#10233E")
MUTED = colors.HexColor("#64748B")
LINE = colors.HexColor("#C7D5E5")
WHITE = colors.white

profiles = ["Guest", "Player", "Captain", "EC", "Neutral\nApprover", "Super\nAdmin"]

rows = [
    ("View Home page", "X", "X", "X", "X", "X", "X"),
    ("View current season", "X", "X", "X", "X", "X", "X"),
    ("View public matches and results", "X", "X", "X", "X", "X", "X"),
    ("View teams, captains and rosters", "X", "X", "X", "X", "X", "X"),
    ("View standings", "X", "X", "X", "X", "X", "X"),
    ("View league rules", "X", "X", "X", "X", "X", "X"),
    ("View About AO", "X", "X", "X", "X", "X", "X"),
    ("View and print active FAQs", "X", "X", "X", "X", "X", "X"),
    ("View past seasons", "X", "X", "X", "X", "X", "X"),
    ("View personal playing history", "", "X", "X", "X", "X", "X"),
    ("Submit lineup", "", "", "X", "X", "", "X"),
    ("Edit lineup before submission", "", "", "X", "X", "", "X"),
    ("Resubmit a rejected lineup", "", "", "X", "X", "", "X"),
    ("View assigned team schedule", "", "", "X", "X", "", "X"),
    ("Schedule approved line matches", "", "", "X", "X", "", "X"),
    ("Submit or update match scores", "", "", "X", "X", "", "X"),
    ("Manage active team roster", "", "", "", "X", "", "X"),
    ("Replace ranked roster players", "", "", "", "X", "", "X"),
    ("Review lineups awaiting approval", "", "", "", "*", "X", "X"),
    ("Approve lineups", "", "", "", "*", "X", "X"),
    ("Reject lineups with a reason", "", "", "", "*", "X", "X"),
    ("Review and resolve submitted scores", "", "", "", "X", "", "X"),
    ("Correct an already approved lineup", "", "", "", "", "", "X"),
    ("Add or update Player Master records", "", "", "", "", "", "X"),
    ("Approve or reject user registrations", "", "", "", "", "", "X"),
    ("Assign or remove user profiles", "", "", "", "", "", "X"),
    ("Add or update venues", "", "", "", "", "", "X"),
    ("Create or update seasons", "", "", "", "", "", "X"),
    ("Manage teams and captain assignments", "", "", "", "", "", "X"),
    ("Manage matchup schedules and deadlines", "", "", "", "", "", "X"),
    ("Assign Neutral Approvers", "", "", "", "", "", "X"),
    ("Manage About AO content", "", "", "", "", "", "X"),
    ("Manage FAQ categories and display order", "", "", "", "", "", "X"),
    ("Add, update or delete FAQs", "", "", "", "", "", "X"),
    ("Import or export season data", "", "", "", "", "", "X"),
    ("Run identity and data-quality audits", "", "", "", "", "", "X"),
    ("Reset season operational data", "", "", "", "", "", "X"),
]

styles = getSampleStyleSheet()
title_style = ParagraphStyle(
    "Title",
    parent=styles["Title"],
    fontName="Helvetica-Bold",
    fontSize=23,
    leading=27,
    textColor=WHITE,
    alignment=TA_LEFT,
    spaceAfter=2,
)
subtitle_style = ParagraphStyle(
    "Subtitle",
    parent=styles["Normal"],
    fontName="Helvetica-Bold",
    fontSize=9,
    leading=12,
    textColor=LIME,
)
cell_style = ParagraphStyle(
    "Cell",
    parent=styles["Normal"],
    fontName="Helvetica",
    fontSize=7.2,
    leading=8.6,
    textColor=INK,
)
head_style = ParagraphStyle(
    "Head",
    parent=styles["Normal"],
    fontName="Helvetica-Bold",
    fontSize=7.2,
    leading=8.2,
    textColor=WHITE,
    alignment=TA_CENTER,
)
note_style = ParagraphStyle(
    "Note",
    parent=styles["Normal"],
    fontName="Helvetica",
    fontSize=8.2,
    leading=11,
    textColor=INK,
)
hierarchy_title = ParagraphStyle(
    "HierarchyTitle",
    parent=styles["Heading2"],
    fontName="Helvetica-Bold",
    fontSize=15,
    leading=18,
    textColor=NAVY,
    spaceAfter=8,
)


def page_header(canvas, doc):
    width, height = landscape(letter)
    canvas.saveState()
    canvas.setFillColor(NAVY)
    canvas.rect(0, height - 0.72 * inch, width, 0.72 * inch, stroke=0, fill=1)
    canvas.setFont("Helvetica-Bold", 8)
    canvas.setFillColor(WHITE)
    canvas.drawRightString(width - 0.42 * inch, height - 0.43 * inch, f"AO ACCESS CONTROL  |  PAGE {doc.page}")
    canvas.setFillColor(NAVY)
    canvas.setFont("Helvetica", 7)
    canvas.drawString(0.42 * inch, 0.24 * inch, "AlphaOpen - Website profile and function authorization")
    canvas.drawRightString(width - 0.42 * inch, 0.24 * inch, "X = Access   * = Conditional access")
    canvas.restoreState()


def matrix_table(part_rows):
    header = [Paragraph("FUNCTION", head_style)] + [
        Paragraph(name.replace("\n", "<br/>"), head_style) for name in profiles
    ]
    body = []
    for name, *marks in part_rows:
        body.append([Paragraph(name, cell_style)] + marks)
    table = Table(
        [header] + body,
        colWidths=[3.46 * inch] + [1.02 * inch] * 6,
        rowHeights=[0.37 * inch] + [0.255 * inch] * len(body),
        repeatRows=1,
    )
    style = [
        ("BACKGROUND", (0, 0), (-1, 0), BLUE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (1, 1), (-1, -1), "CENTER"),
        ("FONTNAME", (1, 1), (-1, -1), "Helvetica-Bold"),
        ("FONTSIZE", (1, 1), (-1, -1), 10),
        ("TEXTCOLOR", (1, 1), (-1, -1), BLUE),
        ("GRID", (0, 0), (-1, -1), 0.45, LINE),
        ("LEFTPADDING", (0, 1), (0, -1), 7),
        ("RIGHTPADDING", (0, 1), (0, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
    ]
    for row_index in range(1, len(body) + 1):
        style.append(
            ("BACKGROUND", (0, row_index), (-1, row_index), PALE_BLUE if row_index % 2 else MID_BLUE)
        )
    table.setStyle(TableStyle(style))
    return table


def title_block(part):
    data = [
        [
            Paragraph("AO Website Functions/Access", title_style),
            Paragraph(f"PROFILE ACCESS MATRIX - PART {part} OF 2", subtitle_style),
        ]
    ]
    block = Table(data, colWidths=[7.6 * inch, 2.0 * inch], rowHeights=[0.56 * inch])
    block.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), NAVY),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("ALIGN", (1, 0), (1, 0), "RIGHT"),
                ("LEFTPADDING", (0, 0), (0, 0), 14),
                ("RIGHTPADDING", (1, 0), (1, 0), 14),
            ]
        )
    )
    return block


def hierarchy_block():
    hierarchy_data = [
        [
            Paragraph("<b>1. SUPER ADMIN</b><br/><font size='7'>All functions; supersedes all profiles</font>", note_style),
            Paragraph("<b>2. EC</b><br/><font size='7'>Season operations, rosters, schedules and scores</font>", note_style),
            Paragraph("<b>3. CAPTAIN</b><br/><font size='7'>Assigned-team lineups, scheduling and scores</font>", note_style),
        ],
        [
            Paragraph("<b>4. NEUTRAL APPROVER</b><br/><font size='7'>Review, approve or reject lineups only</font>", note_style),
            Paragraph("<b>5. PLAYER</b><br/><font size='7'>Public information and personal history</font>", note_style),
            Paragraph("<b>6. GUEST</b><br/><font size='7'>Public information only</font>", note_style),
        ],
    ]
    table = Table(hierarchy_data, colWidths=[3.2 * inch] * 3, rowHeights=[0.56 * inch] * 2)
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), MID_BLUE),
                ("BOX", (0, 0), (-1, -1), 0.8, BLUE),
                ("INNERGRID", (0, 0), (-1, -1), 0.45, LINE),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 9),
                ("RIGHTPADDING", (0, 0), (-1, -1), 9),
            ]
        )
    )
    return table


doc = SimpleDocTemplate(
    str(OUTPUT),
    pagesize=landscape(letter),
    rightMargin=0.42 * inch,
    leftMargin=0.42 * inch,
    topMargin=0.88 * inch,
    bottomMargin=0.42 * inch,
    title="AO Website Functions/Access",
    author="AlphaOpen",
    subject="Website profile access matrix and hierarchy",
)

story = []
story.extend([title_block(1), Spacer(1, 0.12 * inch), matrix_table(rows[:21])])
story.append(PageBreak())
story.extend([title_block(2), Spacer(1, 0.12 * inch), matrix_table(rows[21:])])
story.append(Spacer(1, 0.12 * inch))
story.append(
    KeepTogether(
        [
            Paragraph(
                "<b>* Conditional EC approval access:</b> An EC can review, approve or reject lineups only when that person is also assigned the Neutral Approver profile. A Neutral Approver cannot submit or resubmit a lineup.",
                note_style,
            ),
            Spacer(1, 0.09 * inch),
            Paragraph("Profile Hierarchy", hierarchy_title),
            hierarchy_block(),
        ]
    )
)

doc.build(story, onFirstPage=page_header, onLaterPages=page_header)
print(OUTPUT)
