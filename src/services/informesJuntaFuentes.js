const fs = require('node:fs/promises');
const path = require('node:path');
// EOT v1, uncompressed full fonts. Specification and OFL provenance are in docs.
function toEot(font) {
  const tables = new Map();
  for (let i=0;i<font.readUInt16BE(4);i++) { const pos=12+i*16; tables.set(font.toString('ascii',pos,pos+4),font.subarray(font.readUInt32BE(pos+8),font.readUInt32BE(pos+8)+font.readUInt32BE(pos+12))); }
  const os=tables.get('OS/2'),head=tables.get('head'),names=tables.get('name');
  if (!os || !head || !names || (os.readUInt16BE(8)&0x0002)) throw new Error('La fuente no permite la incrustación.');
  const strings=new Map();
  for(let i=0;i<names.readUInt16BE(2);i++) {
    const p=6+i*12,platform=names.readUInt16BE(p),language=names.readUInt16BE(p+4),id=names.readUInt16BE(p+6);
    if (![0,3].includes(platform) || (platform===3 && language!==0x0409) || ![1,2,4,5].includes(id)) continue;
    const start=names.readUInt16BE(4)+names.readUInt16BE(p+10),raw=Buffer.from(names.subarray(start,start+names.readUInt16BE(p+8)));
    raw.swap16(); strings.set(id,raw.toString('utf16le'));
  }
  const header=Buffer.alloc(82); header.writeUInt32LE(font.length,4); header.writeUInt32LE(0x00010000,8);
  os.copy(header,16,32,42); header[26]=1; header[27]=os.readUInt16BE(62)&1;
  header.writeUInt32LE(os.readUInt16BE(4),28); header.writeUInt16LE(os.readUInt16BE(8),32); header.writeUInt16LE(0x504c,34);
  for(let i=0;i<4;i++) header.writeUInt32LE(os.readUInt32BE(42+i*4),36+i*4);
  if(os.length>=86) for(let i=0;i<2;i++) header.writeUInt32LE(os.readUInt32BE(78+i*4),52+i*4);
  header.writeUInt32LE(head.readUInt32BE(8),60);
  const parts=[header];
  [1,2,5,4].forEach((id,index)=>{const data=Buffer.from(strings.get(id)||'Lato','utf16le'),prefix=Buffer.alloc(index===0?2:4);prefix.writeUInt16LE(data.length,prefix.length-2);parts.push(prefix,data);});
  parts.push(font);const result=Buffer.concat(parts);result.writeUInt32LE(result.length,0);return result;
}
let fonts;
async function embedLato(zip) {
  fonts ||= Promise.all(['Regular','Bold','Italic','BoldItalic'].map(async face=>({face,data:toEot(await fs.readFile(path.join(__dirname,'../../public/fonts/lato',`Lato-${face}.ttf`)))})));
  const files=await fonts;
  for(const file of files) zip.file(`ppt/fonts/auto-lato-${file.face.toLowerCase()}.fntdata`,file.data,{createFolders:false});
  let rels=await zip.file('ppt/_rels/presentation.xml.rels').async('string');
  rels=rels.replace('</Relationships>',files.map(file=>`<Relationship Id="rIdAutoLato${file.face}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/font" Target="fonts/auto-lato-${file.face.toLowerCase()}.fntdata"/>`).join('')+'</Relationships>');
  zip.file('ppt/_rels/presentation.xml.rels',rels,{createFolders:false});
  let presentation=await zip.file('ppt/presentation.xml').async('string');
  const list='<p:embeddedFontLst><p:embeddedFont><p:font typeface="Lato"/>'+files.map(file=>`<p:${file.face.charAt(0).toLowerCase()+file.face.slice(1)} r:id="rIdAutoLato${file.face}"/>`).join('')+'</p:embeddedFont></p:embeddedFontLst>';
  presentation=presentation.replace(/<p:presentation\b[^>]*>/,tag=>tag.replace(/\s+(?:embedTrueTypeFonts|saveSubsetFonts)="[^"]*"/g,'').replace(/>$/,' embedTrueTypeFonts="1" saveSubsetFonts="0">'));
  if(/<p:notesSz\b[^>]*\/>/.test(presentation)) presentation=presentation.replace(/<p:notesSz\b[^>]*\/>/,tag=>tag+list);
  else presentation=presentation.replace('<p:defaultTextStyle>',list+'<p:defaultTextStyle>');
  zip.file('ppt/presentation.xml',presentation,{createFolders:false});
  let contentTypes=await zip.file('[Content_Types].xml').async('string');
  if(!/Extension="fntdata"/.test(contentTypes)) contentTypes=contentTypes.replace('</Types>','<Default Extension="fntdata" ContentType="application/x-fontdata"/></Types>');
  zip.file('[Content_Types].xml',contentTypes,{createFolders:false});
}
module.exports={toEot,embedLato};
