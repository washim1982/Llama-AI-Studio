import { parseGgufHeader } from '../electron/gguf';

const targetFile = process.argv[2];
if (!targetFile) {
  console.log('Usage: npx tsx scripts/inspect-gguf.ts <path-to-gguf>');
  process.exit(1);
}

try {
  const model = parseGgufHeader(targetFile);
  console.log('GGUF Inspection Results:');
  console.log(JSON.stringify(model, null, 2));
} catch (err: any) {
  console.error('Inspection failed:', err.message);
}
