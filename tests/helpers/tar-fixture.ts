/** Build a minimal ustar archive in-memory (test fixture for cells.importSrc). */
import { Buffer } from 'node:buffer';

export function buildTar(files: Array<{ name: string; content: string }>): Buffer {
  const blocks: Buffer[] = [];
  for (const f of files) {
    const data = Buffer.from(f.content, 'utf8');
    const header = Buffer.alloc(512);
    header.write(f.name, 0, 100, 'utf8');
    header.write('0000644\0', 100, 8, 'ascii'); // mode
    header.write('0000000\0', 108, 8, 'ascii'); // uid
    header.write('0000000\0', 116, 8, 'ascii'); // gid
    header.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii');
    header.write('00000000000\0', 136, 12, 'ascii'); // mtime
    header.write('        ', 148, 8, 'ascii'); // checksum placeholder (spaces)
    header.write('0', 156, 1, 'ascii'); // typeflag: regular file
    header.write('ustar\0', 257, 6, 'ascii');
    header.write('00', 263, 2, 'ascii');
    let sum = 0;
    for (const b of header) sum += b;
    header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
    blocks.push(header, data);
    const pad = (512 - (data.length % 512)) % 512;
    if (pad) blocks.push(Buffer.alloc(pad));
  }
  blocks.push(Buffer.alloc(1024)); // end-of-archive
  return Buffer.concat(blocks);
}
