/*
 * Kiểm tra bộ đọc bình luận (fb-extract.js) trên Chromium thật với trang giả lập Facebook.
 * Chạy: node extension/test/extract.test.cjs   (cần Playwright)
 */
const path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('file://' + path.join(__dirname, 'fixture-live.html'));
  await page.addScriptTag({ path: path.join(__dirname, '..', 'fb-extract.js') });

  const read = () => page.evaluate(() => CheckliveFB.findCommentArticles(document).map((el) => CheckliveFB.extractComment(el)));

  // Bình luận có sẵn
  let list = await read();
  assert.strictEqual(list.length, 1, 'chỉ có 1 bình luận (không tính video chính)');
  assert.deepStrictEqual(list[0], {
    id: 'Y29tbWVudDoxMTFfMQ==',
    author: { name: 'Nguyễn Thu Hà', id: '100011112222', url: 'https://www.facebook.com/profile.php?id=100011112222', avatar: 'https://scontent.xx.fbcdn.net/avatar-ha.jpg' },
    text: 'A1 đỏ M',
  });

  await page.evaluate(() => {
    addComment({ name: 'Trần Minh Anh', profile: 'https://www.facebook.com/tran.minhanh.99', text: 'chốt A2 size L 2 cái', commentId: 'c-2' });
    addComment({ name: 'Lê Hoàng Yến', profile: 'https://www.facebook.com/groups/123456/user/100055556666/', text: '0912 345 678 lấy A3', commentId: 'c-3' });
    const p = addComment({ name: 'Phạm Lan', profile: 'https://www.facebook.com/profile.php?id=100077778888', text: 'A1 đẹp quá', emoji: '😍', commentId: 'c-4' });
    p.id = 'parent4';
    addComment({ name: 'Shop Lan Anh', profile: 'https://www.facebook.com/shoplananh', text: 'Dạ còn ạ', commentId: 'c-4-r1', parent: '#parent4' });
    addComment({ name: 'Vũ Thắng', profile: 'https://www.facebook.com/vu.thang', text: '', sticker: true, commentId: 'c-5' });
    addComment({ name: 'Đỗ Như', profile: 'https://www.facebook.com/do.nhu', text: 'Mình lấy 2 cái A1 màu đỏ size M nha shop, ship về Đà Nẵng… Xem thêm', commentId: null });
  });
  list = (await read()).filter(Boolean);
  const byName = Object.fromEntries(list.map((c) => [c.author.name, c]));
  assert.strictEqual(byName['Trần Minh Anh'].author.id, 'tran.minhanh.99');
  assert.strictEqual(byName['Trần Minh Anh'].text, 'chốt A2 size L 2 cái');
  assert.strictEqual(byName['Lê Hoàng Yến'].author.id, '100055556666');
  assert.strictEqual(byName['Phạm Lan'].text, 'A1 đẹp quá 😍', 'giữ emoji, không lẫn nội dung phản hồi');
  assert.strictEqual(byName['Shop Lan Anh'].id, 'c-4-r1', 'phản hồi dùng reply_comment_id');
  assert.strictEqual(byName['Shop Lan Anh'].text, 'Dạ còn ạ');
  assert.ok(!byName['Vũ Thắng'], 'nhãn dán không có chữ thì bỏ qua');
  assert.strictEqual(byName['Đỗ Như'].id, undefined, 'không có comment_id');
  assert.ok(byName['Đỗ Như'].text.startsWith('Mình lấy 2 cái A1'));

  // Số người xem, đọc số
  assert.strictEqual(await page.evaluate(() => CheckliveFB.detectViewers(document)), 1200);
  const counts = await page.evaluate(() => ['1,2K', '1.234', '12 N', '1,5 Tr', '856'].map(CheckliveFB.parseCount));
  assert.deepStrictEqual(counts, [1200, 1234, 12000, 1500000, 856]);

  // Link không phải trang cá nhân
  const prof = await page.evaluate(() => [
    CheckliveFB.parseProfile('https://www.facebook.com/shoplananh/videos/987/'),
    CheckliveFB.parseProfile('https://www.facebook.com/watch/?v=1'),
    CheckliveFB.parseProfile('https://example.com/abc'),
    CheckliveFB.parseProfile('https://m.facebook.com/profile.php?id=42'),
  ]);
  assert.deepStrictEqual(prof, [null, null, null, { id: '42', url: 'https://www.facebook.com/profile.php?id=42' }]);

  console.log('✓ fb-extract: tất cả kiểm tra đều qua');
  await browser.close();
})().catch((e) => {
  console.error('✕', e.message);
  process.exit(1);
});
