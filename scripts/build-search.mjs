import * as pagefind from 'pagefind';

// Pagefind's extended binary (the npm package default) segments Chinese with jieba.
const { index, errors } = await pagefind.createIndex({ forceLanguage: 'zh', keepIndexUrl: false, excludeSelectors: ['nav', '.index', '.mobile-chapters'] });
if (errors.length || !index) throw new Error(errors.join('\n') || 'Pagefind index creation failed');
try {
  const scanned = await index.addDirectory({ path: 'dist' });
  if (scanned.errors.length) throw new Error(scanned.errors.join('\n'));
  console.log(`Pagefind indexed ${scanned.page_count} public pages (Chinese segmentation)`);
  const result = await index.writeFiles({ outputPath: 'dist/pagefind' });
  if (result.errors.length) throw new Error(result.errors.join('\n'));
} finally {
  await pagefind.close();
}
