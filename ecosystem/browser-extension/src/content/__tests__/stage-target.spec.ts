// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { readStageImageId } from '../stage-target';

/** Menu shape decides the target type: 分享设计图 only exists for a design. */
function addMenu(hasShareImg: boolean): void {
  const wrap = document.createElement('div');
  wrap.id = 'contextMenuWrap';
  wrap.innerHTML = `
    <ul class="operate-list">
      ${hasShareImg ? '<li class="operate-item"><p class="shareImg">分享设计图</p></li>' : ''}
      <li class="operate-item"><p class="paste">粘贴</p></li>
    </ul>`;
  document.body.append(wrap);
}

function addTree(
  nodes: { id: string; current: boolean; leaf?: boolean }[]
): void {
  const root = document.createElement('div');
  root.id = 'navTreeRoot';
  root.innerHTML = nodes
    .map(node => {
      const classes = ['l-tree-node', 'project-nav-tree-node'];
      if (node.current) classes.push('is-current');
      // Measured: design rows carry is-leafstate, group rows do not.
      if (node.leaf !== false) classes.push('is-leafstate');
      return `<div class="${classes.join(' ')}" node-id="${
        node.id
      }" node-layer="uuid-${node.id}"></div>`;
    })
    .join('');
  document.body.append(root);
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('readStageImageId', () => {
  it('reads node-id from the single selected tree row', () => {
    addMenu(true);
    addTree([
      { id: 'img-1', current: false },
      { id: 'img-2', current: true }
    ]);
    expect(readStageImageId(document)).toBe('img-2');
  });

  it('returns null when the menu has no 分享设计图 entry', () => {
    // Blank-area and group right-clicks get a refresh/paste menu, and the tree
    // row for a group carries a group uuid — never an image id.
    addMenu(false);
    addTree([{ id: 'group-uuid', current: true }]);
    expect(readStageImageId(document)).toBeNull();
  });

  it('returns null when the selected row is a group, not a design', () => {
    // The nav tree's ⋯ button opens this same menu for group rows too, and a
    // group's node-id is a client-generated uuid — building a link from it
    // would point at nothing.
    addMenu(true);
    addTree([{ id: 'group-uuid', current: true, leaf: false }]);
    expect(readStageImageId(document)).toBeNull();
  });

  it('returns null when nothing is selected', () => {
    addMenu(true);
    addTree([{ id: 'img-1', current: false }]);
    expect(readStageImageId(document)).toBeNull();
  });

  it('returns null on a multi-selection', () => {
    addMenu(true);
    addTree([
      { id: 'img-1', current: true },
      { id: 'img-2', current: true }
    ]);
    expect(readStageImageId(document)).toBeNull();
  });

  it('returns null when there is no nav tree at all', () => {
    addMenu(true);
    expect(readStageImageId(document)).toBeNull();
  });

  it('returns null on the detail page, which has neither marker', () => {
    expect(readStageImageId(document)).toBeNull();
  });

  it('ignores a blank node-id', () => {
    addMenu(true);
    addTree([{ id: '   ', current: true }]);
    expect(readStageImageId(document)).toBeNull();
  });
});
