import {
  Document, Packer, Paragraph, TextRun, AlignmentType,
  Footer, PageNumber, BorderStyle, PageBreak
} from 'docx';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { project, opts } = req.body;
    const { includeSynopsis, includeChars, includeCollapsed } = opts || {};

    const FONT = 'Batang';
    const SZ = 24; // 12pt
    const LINE_SPACING = 360; // 줄간격 (240=1줄, 360=1.5줄)

    const t = (text, o = {}) => new TextRun({ text: text||'', font: FONT, size: SZ, ...o });
    const emptyP = (sp = 0) => new Paragraph({ children: [t('')], spacing:{before:0,after:sp} });
    const children = [];

    // 표지
    children.push(emptyP(), emptyP(), emptyP(), emptyP());
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER, spacing: {before:0,after:240},
      children: [new TextRun({ text: project.title||'제목 없음', font:FONT, size:52, bold:true })]
    }));
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER, spacing: {before:0,after:120},
      children: [new TextRun({ text: project.medium||'', font:FONT, size:28 })]
    }));
    if ((project.genreTags||[]).length > 0) {
      children.push(new Paragraph({
        alignment: AlignmentType.CENTER, spacing: {before:0,after:0},
        children: [new TextRun({ text: project.genreTags.join(' / '), font:FONT, size:22, color:'666666' })]
      }));
    }
    children.push(emptyP(), emptyP(), emptyP());
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: new Date().getFullYear()+'년', font:FONT, size:22 })]
    }));
    children.push(new Paragraph({ children:[new PageBreak()], spacing:{before:0,after:0} }));

    // 시놉시스
    if (includeSynopsis && project.synopsis) {
      children.push(new Paragraph({
        spacing:{before:0,after:240},
        border:{bottom:{style:BorderStyle.SINGLE,size:4,color:'333333',space:4}},
        children:[new TextRun({text:'줄거리',font:FONT,size:30,bold:true})]
      }));
      if (project.theme) children.push(new Paragraph({spacing:{before:0,after:120},children:[t('【주제】 ',{bold:true}),t(project.theme)]}));
      if ((project.loglines||[]).length>0) children.push(new Paragraph({spacing:{before:0,after:120},children:[t('【로그라인】 ',{bold:true}),t(project.loglines[0])]}));
      children.push(new Paragraph({spacing:{before:0,after:0},lineRule:'auto',line:LINE_SPACING,children:[t(project.synopsis)]}));
      children.push(emptyP(), emptyP());
      children.push(new Paragraph({children:[new PageBreak()],spacing:{before:0,after:0}}));
    }

    // 등장인물
    if (includeChars && (project.characters||[]).length>0) {
      children.push(new Paragraph({
        spacing:{before:0,after:240},
        border:{bottom:{style:BorderStyle.SINGLE,size:4,color:'333333',space:4}},
        children:[new TextRun({text:'등장인물',font:FONT,size:30,bold:true})]
      }));
      const sorted = [...(project.characters||[])].sort((a,b)=>(b.importance||0)-(a.importance||0));
      sorted.forEach(c => {
        if (!c.name) return;
        children.push(new Paragraph({spacing:{before:160,after:60},children:[t(c.name,{bold:true})]}));
        if (c.description) children.push(new Paragraph({spacing:{before:0,after:60},children:[t(c.description)]}));
        if ((c.traits||[]).length>0) {
          children.push(new Paragraph({
            spacing:{before:0,after:120},indent:{left:360},
            children:[new TextRun({text:c.traits.join(' · '),font:FONT,size:22,color:'555555'})]
          }));
        }
      });
      children.push(emptyP());
      children.push(new Paragraph({children:[new PageBreak()],spacing:{before:0,after:0}}));
    }

    // 대본 본문
    // 대화 좌우 여백 — 가운데 정렬, 넓은 대사 영역
    const DLG_LEFT  = 1080; // 0.75인치
    const DLG_RIGHT = 1080;
    const CHAR_LEFT = 3240; // 2.25인치 (배역명 들여쓰기)
    const PAREN_LEFT = 2520; // 1.75인치

    let sceneCount = 0;
    let prevType = null;

    (project.scenes||[]).forEach((sc) => {
      if (sc.draft) {
        // 대안 씬: 원본이 접혀 있고 대안이 펼쳐져 있을 때만 포함
        const original = (project.scenes||[]).find(s => s.id === sc.draftOf);
        const originalCollapsed = original && original.collapsed && !includeCollapsed;
        if (!originalCollapsed) return;
        if (sc.collapsed && !includeCollapsed) return;
      } else {
        if (sc.collapsed && !includeCollapsed) return;
      }
      const si = sceneCount++;

      // 씬 간격 — 넓게
      if (si > 0) {
        children.push(emptyP(0));
        children.push(emptyP(0));
        children.push(emptyP(240));
      }

      const slug = (sc.lines||[]).find(l=>l.type==='slug');
      children.push(new Paragraph({
        spacing:{before:0,after:160,line:LINE_SPACING,lineRule:'auto'},
        children:[
          new TextRun({text:'S#'+(si+1)+'.  ',font:FONT,size:SZ,bold:true}),
          new TextRun({text:slug?.text||'INT. 장소 - 시간',font:FONT,size:SZ,bold:true})
        ]
      }));
      children.push(emptyP(120));
      prevType = 'slug';

      (sc.lines||[]).forEach(line => {
        if (line.type==='slug') return;

        if (line.type==='action') {
          // 배역명/대사 뒤에 지문이 오면 위 간격 추가
          const spaceBefore = (prevType==='dialogue'||prevType==='parenthetical') ? 200 : 0;
          children.push(new Paragraph({
            spacing:{before:spaceBefore,after:80,line:LINE_SPACING,lineRule:'auto'},
            children:[t(line.text)]
          }));
          prevType = 'action';

        } else if (line.type==='character') {
          // 지문/대사 뒤에 배역명이 오면 위 간격 추가
          const spaceBefore = (prevType==='action'||prevType==='dialogue'||prevType==='slug') ? 240 : 120;
          children.push(new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing:{before:spaceBefore,after:60,line:LINE_SPACING,lineRule:'auto'},
            children:[new TextRun({text:line.text,font:FONT,size:SZ,bold:true})]
          }));
          prevType = 'character';

        } else if (line.type==='parenthetical') {
          const txt = line.text.startsWith('(') ? line.text : '('+line.text+')';
          children.push(new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing:{before:40,after:40,line:LINE_SPACING,lineRule:'auto'},
            children:[t(txt,{italics:true})]
          }));
          prevType = 'parenthetical';

        } else if (line.type==='dialogue') {
          children.push(new Paragraph({
            alignment: AlignmentType.CENTER,
            indent:{left:DLG_LEFT,right:DLG_RIGHT},
            spacing:{before:0,after:80,line:LINE_SPACING,lineRule:'auto'},
            children:[t(line.text,{bold:!!line.keyline})]
          }));
          prevType = 'dialogue';
        }
      });
    });

    const footer = new Footer({
      children:[new Paragraph({
        alignment:AlignmentType.CENTER,
        children:[new TextRun({children:[PageNumber.CURRENT],font:FONT,size:20})]
      })]
    });

    const doc = new Document({
      styles:{default:{document:{run:{font:FONT,size:SZ}}}},
      sections:[{
        properties:{page:{
          size:{width:11906,height:16838},
          margin:{top:1440,right:1440,bottom:1440,left:1440}
        }},
        footers:{default:footer},
        children
      }]
    });

    const buffer = await Packer.toBuffer(doc);
    const filename = encodeURIComponent((project.title||'대본') + '.docx');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
    res.send(buffer);

  } catch(e) {
    console.error('export-docx error:', e);
    res.status(500).json({ error: e.message });
  }
}
