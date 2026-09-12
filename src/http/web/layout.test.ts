import { describe, expect, it } from 'vitest';
import { escapeHtml, html, raw } from './layout';

describe('html templating', () => {
  it('escapes interpolated values', () => {
    const evil = '<script>alert(1)</script>';
    expect(html`<p>${evil}</p>`.__html).toBe(
      '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>',
    );
  });

  it('escapes quotes so an attribute cannot be broken out of', () => {
    const evil = '" onmouseover="steal()';
    const out = html`<input value="${evil}" />`.__html;
    expect(out).toBe('<input value="&quot; onmouseover=&quot;steal()" />');
    expect(out).not.toContain('onmouseover="steal()"');
  });

  it('passes through values explicitly marked raw', () => {
    expect(html`<div>${raw('<b>bold</b>')}</div>`.__html).toBe('<div><b>bold</b></div>');
  });

  it('renders nested templates and arrays without double-escaping', () => {
    const rows = ['a&b', 'c<d'].map((x) => html`<li>${x}</li>`);
    expect(html`<ul>${rows}</ul>`.__html).toBe('<ul><li>a&amp;b</li><li>c&lt;d</li></ul>');
  });

  it('drops null, undefined and booleans so conditionals render nothing', () => {
    expect(html`${null}${undefined}${false}${true}`.__html).toBe('');
  });

  it('escapes every dangerous character', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });
});
