// localizeImageUrls / renderHtml `assetsDir` override (used by the CLI
// --assets-dir flag): replaces the default ./src/assets/<design-name> prefix.
import { renderHtml } from '../../pipeline/stages';
import { localizeImageUrls } from '../schema-to-html';

const HTML =
  '<div class="box" style="background-image: url(https://oss.example.com/a.png)">' +
  '<img src="https://oss.example.com/b.jpg"></div>';

describe('localizeImageUrls — assetsDir override', () => {
  test('uses the default design-name prefix when assetsDir is omitted', () => {
    const { mapping } = localizeImageUrls(HTML, 'Home Page');
    expect(Object.keys(mapping)).toEqual([
      './src/assets/home-page/icon-1.png',
      './src/assets/home-page/icon-2.jpg'
    ]);
  });

  test('replaces the prefix with assetsDir (trailing slash normalized)', () => {
    const { html, mapping } = localizeImageUrls(HTML, 'Home Page', 'assets/lanhu/');
    expect(Object.keys(mapping)).toEqual([
      'assets/lanhu/icon-1.png',
      'assets/lanhu/icon-2.jpg'
    ]);
    expect(html).toContain('src="assets/lanhu/icon-2.jpg"');
    expect(html).not.toContain('src/assets/home-page');
  });

  test('renderHtml threads assetsDir into the mapping', async () => {
    const schema = {
      type: 'lanhuimage',
      props: { className: 'hero', src: 'https://oss.example.com/bg.png' }
    };
    const { assetsMapping } = await renderHtml(schema, {
      designName: 'ignored-when-dir-set',
      assetsDir: './public/img'
    });
    expect(Object.keys(assetsMapping)).toEqual(['./public/img/icon-1.png']);
  });
});
