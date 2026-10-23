'use strict';

const api = window.cachenook;

const GROUP_NAMES = { system: 'System', developer: 'Developer' };
const HARD_DELETE = new Set(['trash', 'ios-backups']);
const ICONS = new Set([
  'alert-triangle',
  'archive',
  'arrow-up-right',
  'beer',
  'box',
  'brand-docker',
  'brand-npm',
  'check',
  'chevron-down',
  'circle-check',
  'code',
  'database',
  'device-desktop',
  'device-mobile',
  'file',
  'file-text',
  'folder',
  'mail',
  'package',
  'refresh',
  'search',
  'server',
  'settings',
  'sparkles',
  'trash',
  'x',
]);

const state = {
  loaded: false,
  loadError: null,
  view: 'clean',
  lang: 'en',
  home: '',
  version: '',
  config: null,
  configPath: '',
  disk: null,
  fullDiskAccess: false,
  staleJob: null,
  history: [],
  historySummary: null,
  deep: { snapshots: 0 },
  loginItem: false,
  targets: [],
  sizes: new Map(),
  selected: new Set(),
  expanded: new Set(),
  scan: { running: false, completed: 0, total: 0 },
  clean: { running: false, total: 0, done: 0, currentId: null, cleaned: new Set() },
  banner: null,
  projects: {
    status: 'idle',
    items: [],
    selected: new Set(),
    progress: null,
    error: null,
    query: '',
  },
  files: {
    status: 'idle',
    items: [],
    selected: new Set(),
    error: null,
    minMB: 300,
    query: '',
  },
};

const TARGET_VI = {
  'app-caches': { name: 'Bộ nhớ đệm ứng dụng', desc: 'File tạm ứng dụng tự tạo lại khi cần. An toàn để xoá.' },
  'user-logs': { name: 'Log và báo cáo lỗi', desc: 'Log chẩn đoán do ứng dụng và hệ thống ghi.' },
  'saved-state': { name: 'Trạng thái cửa sổ đã lưu', desc: 'Dữ liệu khôi phục cho ứng dụng đã đóng.' },
  trash: { name: 'Thùng rác', desc: 'Dọn sạch Thùng rác. Không thể hoàn tác.' },
  'ios-backups': { name: 'Backup iPhone và iPad', desc: 'Backup thiết bị cục bộ. Chỉ xoá nếu bạn có bản backup khác.' },
  'mail-downloads': { name: 'Tệp đính kèm Mail đã tải', desc: 'Bản sao đính kèm đã có trong hộp thư.' },
  'xcode-derived': { name: 'Dữ liệu build Xcode', desc: 'DerivedData. Xcode sẽ tạo lại ở lần build sau.' },
  'xcode-device-support': { name: 'Hỗ trợ thiết bị Xcode', desc: 'Symbol cho các bản iOS. Tải lại khi kết nối thiết bị.' },
  'xcode-archives': { name: 'Archive Xcode', desc: 'Bản build đã archive và dSYM dùng để upload App Store.' },
  'xcode-previews': { name: 'Dữ liệu SwiftUI Preview', desc: 'Bản build và thumbnail cho Xcode Preview.' },
  'simulator-caches': { name: 'Cache Simulator', desc: 'Disk image và cache của iOS Simulator.' },
  'npm-cache': { name: 'Cache npm', desc: 'Tarball package đã tải. npm sẽ tải lại khi cần.' },
  'pnpm-store': { name: 'Kho pnpm', desc: 'Kho package dùng chung. Cần cài lại sau khi xoá.' },
  'gradle-caches': { name: 'Cache Gradle', desc: 'Phụ thuộc build Android/JVM. Tải lại khi build.' },
  'cargo-cache': { name: 'Cache crate Rust', desc: 'Crate đã tải và giải nén. cargo sẽ tải lại.' },
  'ai-caches': { name: 'Cache model AI', desc: 'Model đã tải từ Hugging Face, Ollama và LM Studio.' },
  'bun-cache': { name: 'Cache cài đặt Bun', desc: 'Package Bun đã tải. Bun sẽ tải lại.' },
  'uv-cache': { name: 'Cache uv', desc: 'Wheel và bản build Python do uv cache.' },
  'conda-pkgs': { name: 'Package Conda', desc: 'Package conda đã tải. Tải lại ở lần cài sau.' },
  'maven-repo': { name: 'Kho Maven', desc: 'Phụ thuộc JVM trong ~/.m2. Tải lại ở lần build sau.' },
  'go-mod-cache': { name: 'Cache module Go', desc: 'Module Go đã tải. go mod download sẽ tải lại.' },
  'npx-cache': { name: 'Cache npx', desc: 'Package tạm do npx cài.' },
  'electron-cache': { name: 'Bản tải Electron', desc: 'Bản tải Electron và electron-builder đã cache.' },
  'brew-cleanup': { name: 'Homebrew phiên bản cũ', desc: 'Phiên bản formula cũ và bản tải dư.' },
  'docker-prune': { name: 'Dữ liệu Docker không dùng', desc: 'Image, container, volume và build cache không dùng.' },
  'simulator-unavailable': { name: 'Simulator lỗi thời', desc: 'Runtime simulator không còn dùng được.' },
};

function tt(en, vi, vars = {}) {
  const template = state.lang === 'vi' ? vi : en;
  return template.replace(/\{(\w+)\}/g, (_, key) => (vars[key] ?? `{${key}}`));
}

function locale() {
  return state.lang === 'vi' ? 'vi-VN' : undefined;
}

function formatShortDate(date) {
  if (state.lang === 'vi') {
    return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(
      2,
      '0',
    )}`;
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatRunTime(iso) {
  const date = new Date(iso);
  if (state.lang === 'vi') {
    return `${formatShortDate(date)} ${date.toLocaleTimeString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
    })}`;
  }
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function groupLabel(group) {
  if (state.lang === 'vi') {
    return { system: 'Hệ thống', developer: 'Nhà phát triển' }[group] || group;
  }
  return GROUP_NAMES[group];
}

function targetName(target) {
  return state.lang === 'vi' ? TARGET_VI[target.id]?.name || target.name : target.name;
}

function translateNote(note) {
  if (state.lang !== 'vi' || !note) return note;

  const exact = {
    'Old versions and stale downloads': 'Phiên bản cũ và bản tải dư',
    'Unused images, containers and build cache': 'Image, container và build cache không dùng',
    'No unavailable simulators': 'Không có simulator lỗi thời',
    'Docker is not installed': 'Chưa cài Docker',
    'Docker is not running': 'Docker chưa chạy',
    'Homebrew is not installed': 'Chưa cài Homebrew',
    'Simulator tools require a full Xcode install': 'Cần cài Xcode đầy đủ để dùng Simulator',
  };
  if (exact[note]) return exact[note];

  const simulators = /^(\d+) outdated simulators?$/.exec(note);
  if (simulators) return `${simulators[1]} simulator lỗi thời`;
  return note;
}

function targetDescription(target) {
  return state.lang === 'vi'
    ? TARGET_VI[target.id]?.desc || target.description
    : target.description;
}

function applyLanguage() {
  document.documentElement.lang = state.lang === 'vi' ? 'vi' : 'en';

  const labels = {
    clean: tt('Cleanup', 'Dọn dẹp'),
    projects: tt('Projects', 'Dự án'),
    files: tt('Large files', 'File lớn'),
  };
  document.querySelectorAll('.tab[data-view]').forEach((tab) => {
    if (labels[tab.dataset.view]) tab.textContent = labels[tab.dataset.view];
  });

  const rescan = document.getElementById('rescan-button');
  if (rescan) {
    rescan.title = tt('Scan again', 'Quét lại');
    rescan.setAttribute('aria-label', rescan.title);
  }

  const settings = document.getElementById('settings-button');
  if (settings) {
    settings.title = tt('Settings', 'Cài đặt');
    settings.setAttribute('aria-label', settings.title);
  }
}

const els = {
  view: document.getElementById('view'),
  banner: document.getElementById('banner'),
  actionbar: document.getElementById('actionbar'),
  rescanButton: document.getElementById('rescan-button'),
  modalRoot: document.getElementById('modal-root'),
  toastRoot: document.getElementById('toast-root'),
  scroll: document.getElementById('scroll'),
};

let dialog = null;
let renderQueued = false;

/* ---------- formatting ---------- */

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log10(n) / 3));
  const value = n / 1000 ** index;
  const digits =
    index === 0 ? 0 : value >= 100 ? 0 : value >= 1 ? (index >= 3 ? 1 : 0) : 2;
  const rounded = value.toFixed(digits).replace(/\.0$/, '');
  return `${rounded} ${units[index]}`;
}

function formatCount(value) {
  return new Intl.NumberFormat('en-US').format(Number(value) || 0);
}

function formatAge(timestamp) {
  if (!timestamp) return '';
  const days = (Date.now() - timestamp) / 86_400_000;
  if (days < 1) return 'today';
  if (days < 30) return `${Math.round(days)}d ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return `${Math.round(days / 365)}y ago`;
}

function tilde(filePath) {
  if (!state.home) return filePath;
  if (filePath === state.home) return '~';
  if (filePath.startsWith(`${state.home}/`)) return `~${filePath.slice(state.home.length)}`;
  return filePath;
}

function icon(name, className = '') {
  const safe = ICONS.has(name) ? name : 'file';
  return `<span class="icon ${className}" style="--icon: url(icons/${safe}.svg)"></span>`;
}

function targetById(id) {
  return state.targets.find((target) => target.id === id) || null;
}

function sizeOf(id) {
  return state.sizes.get(id) || null;
}

function isSelectableTarget(id) {
  const size = sizeOf(id);
  return Boolean(size && size.status === 'ready' && size.bytes > 0);
}

function selectedTargetIds() {
  return [...state.selected].filter(isSelectableTarget);
}

function selectedTargetBytes() {
  return selectedTargetIds().reduce((sum, id) => sum + (sizeOf(id)?.bytes || 0), 0);
}

function totalReclaimable() {
  let total = 0;
  for (const size of state.sizes.values()) {
    if (size.status === 'ready') total += size.bytes || 0;
  }
  return total;
}

/* ---------- derived views ---------- */

function visibleTargets(group) {
  return state.targets.filter((target) => {
    if (group && target.group !== group) return false;
    if (target.protected && !state.fullDiskAccess) return false;
    const size = state.sizes.get(target.id);
    if (!size) return true;
    if (size.status === 'unavailable' || size.status === 'error') return false;
    if (size.status === 'ready' && size.bytes <= 0) return false;
    return true;
  });
}

function currentViewTargets() {
  if (state.view === 'clean') return visibleTargets();
  return visibleTargets(state.view);
}

function isCleanView() {
  return state.view === 'clean' || state.view === 'system' || state.view === 'developer';
}

function isBusy() {
  if (state.clean.running) return true;
  if (state.scan.running && isCleanView()) return true;
  if (state.projects.status === 'scanning' && state.view === 'projects') return true;
  if (state.files.status === 'scanning' && state.view === 'files') return true;
  return false;
}

/* ---------- render root ---------- */

function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    render();
  });
}

function render() {
  const active = document.activeElement;
  const focusId = active && active.id;
  const caret =
    active && typeof active.selectionStart === 'number' ? active.selectionStart : null;

  renderChrome();
  renderBanner();

  if (!state.loaded) {
    renderLoading();
  } else if (state.view === 'projects') {
    renderProjects();
  } else if (state.view === 'files') {
    renderFiles();
  } else {
    renderClean();
  }

  updateDisk();
  renderActionbar();

  if (focusId) {
    const next = document.getElementById(focusId);
    if (next) {
      next.focus();
      if (caret !== null && typeof next.setSelectionRange === 'function') {
        try {
          next.setSelectionRange(caret, caret);
        } catch {
          // not a text field
        }
      }
    }
  }
}

function renderChrome() {
  document.querySelectorAll('.tab[data-view]').forEach((tab) => {
    const active = tab.dataset.view === state.view;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
  });

  const scanning =
    state.scan.running ||
    state.projects.status === 'scanning' ||
    state.files.status === 'scanning';
  const cleaning = state.clean.running;

  els.rescanButton.disabled = cleaning;
  if (scanning) {
    els.rescanButton.innerHTML = '<span class="spinner"></span>';
    els.rescanButton.setAttribute('aria-label', tt('Cancel scan', 'Huỷ quét'));
    els.rescanButton.title = tt('Cancel scan', 'Huỷ quét');
  } else if (cleaning) {
    els.rescanButton.innerHTML = '<span class="spinner"></span>';
    els.rescanButton.setAttribute('aria-label', tt('Cleaning…', 'Đang dọn…'));
    els.rescanButton.title = tt('Cleaning…', 'Đang dọn…');
  } else {
    els.rescanButton.innerHTML =
      '<span class="icon" style="--icon: url(icons/refresh.svg)"></span>';
    els.rescanButton.setAttribute('aria-label', tt('Scan again', 'Quét lại'));
    els.rescanButton.title = tt('Scan again', 'Quét lại');
  }
}

function updateDisk() {
  const disk = state.disk;
  const diskText = document.getElementById('disk-text');
  const diskUsed = document.getElementById('disk-used');
  const diskReclaim = document.getElementById('disk-reclaim');
  const diskBar = document.getElementById('disk-bar');

  if (!diskText || !diskUsed || !diskReclaim || !diskBar) return;

  if (!disk) {
    diskText.textContent = tt('Unavailable', 'Không có dữ liệu');
    diskUsed.style.setProperty('--used', '0');
    diskReclaim.style.setProperty('--reclaim', '0');
    return;
  }

  const accounted = disk.used + disk.available;
  const usedPct = accounted > 0 ? (disk.used / accounted) * 100 : 0;
  const reclaimPct =
    accounted > 0 ? Math.min(usedPct, (totalReclaimable() / accounted) * 100) : 0;
  diskText.textContent = tt(
    '{used} used · {free} free',
    '{used} đã dùng · {free} trống',
    { used: formatBytes(disk.used), free: formatBytes(disk.available) },
  );

  const usedScale = Math.min(1, usedPct / 100);
  const reclaimPart = usedPct > 0 ? Math.min(1, reclaimPct / usedPct) : 0;
  diskUsed.style.setProperty('--used', usedScale.toFixed(4));
  diskReclaim.style.setProperty('--reclaim', reclaimPart.toFixed(4));
  diskBar.setAttribute('aria-valuenow', Math.round(usedPct));
}

function hero({ amount = '', line = '', actions = '', loading = false }) {
  return `<section class="hero">
      <div class="hero-copy">
        <div class="hero-amount">${
          loading ? '<span class="skeleton hero-skeleton"></span>' : esc(amount)
        }</div>
        <p class="hero-line">${esc(line)}</p>
        ${actions ? `<div class="hero-actions">${actions}</div>` : ''}
      </div>
      <div class="hero-disk">
        <div class="disk-row">
          <span class="disk-label">${icon('server', 'disk-icon')}${tt('Disk', 'Ổ đĩa')}</span>
          <span class="disk-text" id="disk-text">Reading…</span>
        </div>
        <div class="disk-bar" id="disk-bar" role="progressbar" aria-label="Disk usage" aria-valuemin="0" aria-valuemax="100">
          <div class="disk-used" id="disk-used"><div class="disk-reclaim" id="disk-reclaim"></div></div>
        </div>
      </div>
    </section>`;
}

function emptyState(title, sub, action = '') {
  return `<div class="empty">
      <div class="empty-badge">${icon('circle-check')}</div>
      <h2 class="empty-title">${esc(title)}</h2>
      <p class="empty-sub">${esc(sub)}</p>
      ${action ? `<p style="margin-top:14px">${action}</p>` : ''}
    </div>`;
}

function progressCard({ text, pct = null }) {
  const width = pct === null ? 0 : Math.max(0, Math.min(100, pct));
  return `<div class="progress-card">
      <span class="spinner"></span>
      <span class="progress-text"${pct === null ? '' : ' id="project-progress-text"'}>${esc(text)}</span>
      ${
        pct === null
          ? ''
          : `<div class="progress-track"><div class="progress-fill" id="project-progress-fill" style="width:${width.toFixed(1)}%"></div></div>`
      }
    </div>`;
}

function renderLoading() {
  if (state.loadError) {
    els.view.innerHTML = hero({
      amount: tt('Could not load', 'Không tải được'),
      line: state.loadError,
      actions: `<button class="ghost-button" type="button" data-action="retry-init">${tt(
        'Try again',
        'Thử lại',
      )}</button>`,
    });
    return;
  }

  els.view.innerHTML =
    hero({ line: tt('Reading disk usage…', 'Đang đọc dung lượng ổ…'), loading: true }) +
    `<div class="sheet">${Array.from({ length: 4 })
      .map(
        () => `<div class="row"><span></span><span class="row-icon"></span>
          <div class="row-body"><div class="row-title"><span class="skeleton" style="width:120px"></span></div>
          <div class="row-desc"><span class="skeleton" style="width:210px"></span></div></div>
          <div class="row-meta"><div class="row-size"><span class="skeleton"></span></div></div>
          <span></span></div>`,
      )
      .join('')}</div>`;
}

function renderBanner() {
  const banner = state.banner;
  if (!banner) {
    els.banner.hidden = true;
    els.banner.innerHTML = '';
    return;
  }
  els.banner.hidden = false;
  els.banner.className = `banner${banner.kind === 'error' ? ' is-error' : ''}`;
  const details = banner.details && banner.details.length > 0;
  const amount = banner.amount
    ? ` <span class="banner-amount">${esc(formatBytes(banner.amount))}</span>`
    : '';

  els.banner.innerHTML = `${icon(banner.kind === 'error' ? 'alert-triangle' : 'circle-check', 'banner-icon')}
    <div class="banner-body">
      <div class="banner-title">${esc(banner.title)}${amount}</div>
      ${banner.sub ? `<div class="banner-sub">${esc(banner.sub)}</div>` : ''}
    </div>
    ${details ? `<button class="link-button" type="button" data-action="banner-details">${tt('Details', 'Chi tiết')}</button>` : ''}
    <button class="icon-button" type="button" data-action="banner-close" aria-label="${esc(
      tt('Dismiss', 'Đóng'),
    )}">${icon('x')}</button>`;

  if (banner.amount && !banner.animated) {
    banner.animated = true;
    const amountEl = els.banner.querySelector('.banner-amount');
    if (amountEl) animateValue(amountEl, banner.amount);
  }
}

/* ---------- cleanup view ---------- */

function renderClean() {
  const groups = state.view === 'clean' ? ['system', 'developer'] : [state.view];
  const visible = groups.flatMap((group) => visibleTargets(group));
  const totalBytes = visible.reduce((sum, target) => sum + (sizeOf(target.id)?.bytes || 0), 0);
  const selectionCount = visible.filter((target) => state.selected.has(target.id)).length;
  const scanning = state.scan.running;

  const line = scanning
    ? tt('Scanning {done} of {total} locations…', 'Đang quét {done}/{total} vị trí…', {
        done: state.scan.completed,
        total: state.scan.total,
      })
    : visible.length === 0
      ? tt('Nothing to clean right now.', 'Hiện không có gì để dọn.')
      : tt('{n} locations of caches, logs and build leftovers.', '{n} vị trí cache, log và build.', {
          n: visible.length,
        });

  const actions = scanning
    ? ''
    : selectionCount > 0
      ? `<button class="text-button is-muted" type="button" data-action="select-none">${tt(
          'Clear selection',
          'Bỏ chọn',
        )}</button>`
      : `<button class="text-button" type="button" data-action="select-safe">${tt(
          'Select safe items',
          'Chọn mục an toàn',
        )}</button>`;

  const groupsHtml = groups
    .map((group) => {
      const list = visibleTargets(group);
      if (list.length === 0) return '';

      const groupBytes = list.reduce(
        (sum, target) => sum + (sizeOf(target.id)?.bytes || 0),
        0,
      );
      const selected = list.filter((target) => state.selected.has(target.id));
      const selectedBytes = selected.reduce(
        (sum, target) => sum + (sizeOf(target.id)?.bytes || 0),
        0,
      );
      const meta =
        selected.length > 0
          ? tt('{n} selected · {size}', '{n} đã chọn · {size}', {
              n: selected.length,
              size: formatBytes(selectedBytes),
            })
          : formatBytes(groupBytes);

      return `<section class="group" aria-labelledby="group-${group}">
          <div class="group-head">
            <h2 class="group-title" id="group-${group}">${groupLabel(group)}</h2>
            <span class="group-meta" data-group-meta="${group}">${meta}</span>
          </div>
          ${list.map(targetRow).join('')}
        </section>`;
    })
    .join('');

  const note = fdaNote();
  const footnote = `<p class="footnote">${tt(
    "iPhone backups and other apps' containers are never scanned.",
    'Backup iPhone và container của ứng dụng khác không bao giờ bị quét.',
  )}</p>`;

  const content =
    visible.length === 0 && !scanning
      ? emptyState(
          tt('Nothing to clean', 'Không có gì để dọn'),
          tt(
            'Caches, logs and build folders are already tidy. Look again later.',
            'Cache, log và thư mục build đã gọn. Quét lại sau.',
          ),
        ) + (note ? `<div class="sheet" style="margin-top:14px">${note}</div>` : '')
      : `<div class="sheet">${groupsHtml}${note}</div>`;

  els.view.innerHTML =
    hero({
      amount: formatBytes(totalBytes),
      line,
      actions,
      loading: scanning && totalBytes === 0,
    }) +
    content +
    footnote;
}

function sheetNote(text, actions) {
  return `<div class="sheet-note">
      ${icon('lock')}
      <p class="sheet-note-text">${text}</p>
      <div class="sheet-note-actions">${actions}</div>
    </div>`;
}

function fdaNote() {
  const hidden = state.targets.filter((target) => target.protected).length;
  if (state.fullDiskAccess || hidden === 0) return '';

  return sheetNote(
    tt(
      '<strong>{n} cleanup locations are hidden by macOS.</strong> App caches, logs and Xcode data live in ~/Library. Grant Full Disk Access to include them.',
      '<strong>macOS đang ẩn {n} vị trí dọn dẹp.</strong> Cache ứng dụng, log và dữ liệu Xcode nằm trong ~/Library. Cấp Full Disk Access để bao gồm chúng.',
      { n: hidden },
    ),
    `<button class="text-button is-muted" type="button" data-action="recheck-fda">${tt(
      'Check again',
      'Kiểm tra lại',
    )}</button><button class="text-button" type="button" data-action="open-fda">${tt(
      'Open settings',
      'Mở cài đặt',
    )}</button>`,
  );
}

function filesNote() {
  if (state.fullDiskAccess) return '';
  return sheetNote(
    tt(
      '<strong>Desktop, Documents and Downloads are skipped.</strong> macOS protects these folders. Grant Full Disk Access to include them.',
      '<strong>Desktop, Documents và Downloads đang bị bỏ qua.</strong> macOS bảo vệ các thư mục này. Cấp Full Disk Access để bao gồm chúng.',
    ),
    `<button class="text-button is-muted" type="button" data-action="recheck-fda">${tt(
      'Check again',
      'Kiểm tra lại',
    )}</button><button class="text-button" type="button" data-action="open-fda">${tt(
      'Open settings',
      'Mở cài đặt',
    )}</button>`,
  );
}

function targetRow(target) {
  const size = sizeOf(target.id) || { status: 'pending', bytes: 0, paths: [], sizes: [] };
  const selected = state.selected.has(target.id);
  const expanded = state.expanded.has(target.id);
  const cleaning = state.clean.currentId === target.id;
  const cleaned = state.clean.cleaned.has(target.id);
  const ready = size.status === 'ready';
  const name = targetName(target);

  let sizeHtml = '<span class="skeleton"></span>';
  if (ready) sizeHtml = esc(formatBytes(size.bytes));
  if (size.status === 'error') sizeHtml = tt('Failed', 'Lỗi');
  if (cleaning) sizeHtml = '<span class="spinner"></span>';
  if (cleaned) {
    sizeHtml = `<span class="row-done">${icon('check')}${tt('Done', 'Xong')}</span>`;
  }

  let note = '';
  if (cleaning) note = tt('Cleaning…', 'Đang dọn…');
  else if (cleaned) note = '';
  else if (size.status === 'error') note = tt('Scan failed', 'Quét lỗi');
  else if (ready && target.kind === 'command') note = translateNote(size.note || '');
  else if (ready && (size.paths || []).length > 1) {
    note = tt('{n} locations', '{n} vị trí', { n: size.paths.length });
  }

  const riskChip =
    target.risk === 'safe'
      ? ''
      : `<span class="risk${HARD_DELETE.has(target.id) ? ' is-danger' : ''}">${tt(
          HARD_DELETE.has(target.id) ? 'Deletes data' : 'Review',
          HARD_DELETE.has(target.id) ? 'Xoá dữ liệu' : 'Xem lại',
        )}</span>`;

  const entries =
    target.kind === 'command'
      ? []
      : (size.sizes && size.sizes.length ? size.sizes : (size.paths || []).map((p) => ({ path: p })));

  const detailRows =
    target.kind === 'command'
      ? `<div class="detail-line">
           <span class="detail-path">${tt(
             'Runs the {command} command',
             'Chạy lệnh {command}',
             { command: target.command || '' },
           )}</span>
           <span class="detail-actions">${size.note ? `<span class="detail-size">${esc(translateNote(size.note))}</span>` : ''}</span>
         </div>`
      : entries
          .map(
            (entry) => `<div class="detail-line">
              <span class="detail-path" title="${esc(entry.path)}">${esc(tilde(entry.path))}</span>
              <span class="detail-actions">
                ${entry.bytes != null ? `<span class="detail-size">${esc(formatBytes(entry.bytes))}</span>` : ''}
                <button class="mini-button" type="button" data-reveal="${esc(entry.path)}">${icon(
                  'arrow-up-right',
                )}${tt('Reveal', 'Mở')}</button>
              </span>
            </div>`,
          )
          .join('');

  return `<div class="row${selected ? ' is-selected' : ''}${expanded ? ' is-expanded' : ''}${
    cleaning ? ' is-cleaning' : ''
  }${cleaned ? ' is-cleaned' : ''}" data-row="target" data-id="${esc(target.id)}">
      <input class="row-check" type="checkbox" data-select="target" data-id="${esc(target.id)}"
        aria-label="${esc(tt('Select {name}', 'Chọn {name}', { name }))}" ${selected ? 'checked' : ''} ${
          ready && size.bytes > 0 && !state.clean.running ? '' : 'disabled'
        } />
      <span class="row-icon">${icon(target.icon)}</span>
      <div class="row-body">
        <div class="row-title-line">
          <span class="row-title">${esc(name)}</span>
          ${riskChip}
        </div>
        <div class="row-desc">${esc(targetDescription(target))}</div>
      </div>
      <div class="row-meta">
        <div class="row-size">${sizeHtml}</div>
        <div class="row-note">${esc(note)}</div>
      </div>
      <button class="row-chevron" type="button" data-expand="${esc(target.id)}"
        aria-label="${esc(
          expanded
            ? tt('Hide locations', 'Ẩn vị trí')
            : tt('Show locations', 'Hiện vị trí'),
        )}" aria-expanded="${expanded}">
        ${icon('chevron-down')}
      </button>
      <div class="row-detail">${detailRows || `<div class="detail-line"><span class="detail-path">${tt(
        'No locations',
        'Không có vị trí',
      )}</span></div>`}</div>
    </div>`;
}

/* ---------- projects view ---------- */

function renderProjects() {
  const projects = state.projects;
  const scanning = projects.status === 'scanning';
  const items = projects.items;
  const total = items.reduce((sum, item) => sum + item.bytes, 0);
  const repoCount = new Set(items.map((item) => item.repo)).size;
  const query = projects.query.trim().toLowerCase();
  const filtered = query
    ? items.filter((item) =>
        `${item.repo} ${item.artifact} ${item.path}`.toLowerCase().includes(query),
      )
    : items;
  const done = projects.progress?.done || 0;
  const totalFolders = projects.progress?.total || 0;
  const pct = totalFolders > 0 ? (done / totalFolders) * 100 : 0;

  const line = scanning
    ? totalFolders > 0
      ? tt(
          'Measuring {done} of {total} build folders…',
          'Đang đo {done}/{total} thư mục build…',
          { done, total: totalFolders },
        )
      : tt('Finding build folders…', 'Đang tìm thư mục build…')
    : items.length
      ? tt(
          '{n} build folders across {m} projects.',
          '{n} thư mục build trong {m} dự án.',
          { n: items.length, m: repoCount },
        )
      : tt(
          'Folders such as node_modules and .next, rebuilt on the next install.',
          'Các thư mục như node_modules và .next, sẽ được tạo lại khi cài/build.',
        );

  const actions = `${
    scanning
      ? `<button class="text-button" type="button" data-action="cancel-projects">${tt(
          'Cancel',
          'Huỷ',
        )}</button>`
      : `<button class="text-button" type="button" data-action="scan-projects">${tt(
          'Scan again',
          'Quét lại',
        )}</button>`
  }<button class="text-button is-muted" type="button" data-action="open-settings">${tt(
    'Choose folders',
    'Chọn thư mục',
  )}</button>`;

  let content = '';
  if (scanning) content += progressCard({ text: line, pct });

  if (projects.status === 'error') {
    content += emptyState(
      tt('Project scan failed', 'Quét dự án thất bại'),
      projects.error || tt('Unknown error', 'Lỗi không rõ'),
      `<button class="ghost-button" type="button" data-action="scan-projects">${tt(
        'Try again',
        'Thử lại',
      )}</button>`,
    );
  } else if (!scanning && projects.status === 'ready' && items.length === 0) {
    content += emptyState(
      tt('No build folders found', 'Không tìm thấy thư mục build'),
      tt(
        'Check that your project folders are set correctly, then scan again.',
        'Kiểm tra lại thư mục dự án rồi quét lại.',
      ),
      `<button class="ghost-button" type="button" data-action="open-settings">${tt(
        'Change folders',
        'Đổi thư mục',
      )}</button>`,
    );
  } else if (!scanning && projects.status === 'idle' && items.length === 0) {
    content += emptyState(
      tt('Scan your projects', 'Quét dự án của bạn'),
      tt(
        'Find node_modules, .next, dist and similar folders that can be rebuilt.',
        'Tìm node_modules, .next, dist và các thư mục tương tự có thể tạo lại.',
      ),
      `<button class="ghost-button" type="button" data-action="scan-projects">${tt(
        'Scan projects',
        'Quét dự án',
      )}</button>`,
    );
  } else if (items.length > 0) {
    content += `<div class="toolbar">
        <div class="search-field">
          ${icon('search')}
          <input class="search-input" id="project-search" type="text" placeholder="${esc(
            tt('Filter by repo or folder', 'Lọc theo repo hoặc thư mục'),
          )}" value="${esc(projects.query)}" autocomplete="off" spellcheck="false" />
        </div>
        <span class="group-meta">${tt('{n} of {total}', '{n}/{total}', {
          n: filtered.length,
          total: items.length,
        })}</span>
      </div>`;

    if (filtered.length === 0) {
      content += emptyState(
        tt('No matches', 'Không có kết quả'),
        tt('Try a different search.', 'Thử từ khoá khác.'),
      );
    } else {
      const groups = new Map();
      for (const item of filtered) {
        if (!groups.has(item.repo)) groups.set(item.repo, []);
        groups.get(item.repo).push(item);
      }

      content += `<div class="sheet">${[...groups.entries()]
        .map(([repo, groupItems]) => {
          const groupBytes = groupItems.reduce((sum, item) => sum + item.bytes, 0);
          const selected = groupItems.filter((item) => projects.selected.has(item.path));
          const repoPath = groupItems[0]?.repoPath || '';
          const ignored = (state.config?.autoCleanIgnore || []).includes(repoPath);
          const meta =
            selected.length > 0
              ? tt('{n} selected', '{n} đã chọn', { n: selected.length })
              : tt('{n} folders · {size}', '{n} thư mục · {size}', {
                  n: groupItems.length,
                  size: formatBytes(groupBytes),
                });
          return `<section class="artifact-group">
              <div class="group-head">
                <h2 class="group-title">${esc(repo)}</h2>
                <div class="group-actions">
                  <span class="group-meta">${esc(meta)}</span>
                  <button class="text-button is-muted" type="button" data-action="toggle-ignore" data-repo="${esc(
                    repoPath,
                  )}">${ignored ? tt('Ignored', 'Đã tắt') : tt('Ignore auto-clean', 'Tắt tự dọn')}</button>
                </div>
              </div>
              <div class="group-box">${groupItems.map(projectRow).join('')}</div>
            </section>`;
        })
        .join('')}</div>`;
    }
  }

  els.view.innerHTML =
    hero({
      amount: formatBytes(total),
      line,
      actions,
      loading: scanning && items.length === 0,
    }) + content;
}

function projectRow(item) {
  const selected = state.projects.selected.has(item.path);
  const relative = item.path.startsWith(`${item.root}/`)
    ? item.path.slice(item.root.length + 1)
    : item.path;
  return `<div class="file-row artifact-row${selected ? ' is-selected' : ''}" data-row="project" data-path="${esc(
    item.path,
  )}">
      <input class="row-check" type="checkbox" data-select="project" data-path="${esc(
        item.path,
      )}" aria-label="${esc(tt('Select {name}', 'Chọn {name}', { name: relative }))}" ${
        selected ? 'checked' : ''
      } />
      <span class="file-icon">${icon(item.artifact === 'node_modules' ? 'brand-npm' : 'package')}</span>
      <div class="file-body">
        <div class="artifact-name">${esc(item.artifact)}</div>
        <div class="artifact-path" title="${esc(item.path)}">${esc(relative)}</div>
      </div>
      <div class="file-size">${esc(formatBytes(item.bytes))}</div>
      <button class="icon-button file-reveal" type="button" data-reveal="${esc(
        item.path,
      )}" aria-label="${esc(tt('Reveal in Finder', 'Mở trong Finder'))}">${icon(
        'arrow-up-right',
      )}</button>
    </div>`;
}

/* ---------- large files view ---------- */

function renderFiles() {
  const files = state.files;
  const scanning = files.status === 'scanning';
  const total = files.items.reduce((sum, file) => sum + file.bytes, 0);
  const query = files.query.trim().toLowerCase();
  const visible = query
    ? files.items.filter(
        (file) =>
          file.name.toLowerCase().includes(query) || file.dir.toLowerCase().includes(query),
      )
    : files.items;

  const fileWord = files.items.length === 1 ? 'file' : 'files';
  const line = scanning
    ? tt('Looking for files over {mb} MB…', 'Đang tìm file trên {mb} MB…', { mb: files.minMB })
    : files.items.length > 0
      ? tt(
          `{n} ${fileWord} over {mb} MB, outside Library folders.`,
          '{n} file trên {mb} MB, ngoài các thư mục Library.',
          { n: files.items.length, mb: files.minMB },
        )
      : tt(
          'Files over {mb} MB outside Library folders.',
          'File trên {mb} MB ngoài các thư mục Library.',
          { mb: files.minMB },
        );

  const actions = `${
    scanning
      ? `<button class="text-button" type="button" data-action="cancel-files">${tt(
          'Cancel',
          'Huỷ',
        )}</button>`
      : `<button class="text-button" type="button" data-action="scan-files">${tt(
          'Scan again',
          'Quét lại',
        )}</button>`
  }<button class="text-button is-muted" type="button" data-action="open-settings">${tt(
    'Threshold',
    'Ngưỡng',
  )}</button>`;

  let content = '';
  if (scanning) {
    content += progressCard({
      text: tt(
        'Scanning your home folder for files over {mb} MB.',
        'Đang quét thư mục home để tìm file trên {mb} MB.',
        { mb: files.minMB },
      ),
    });
  }

  const note = filesNote();

  if (files.status === 'error') {
    content += emptyState(
      tt('File scan failed', 'Quét file thất bại'),
      files.error || tt('Unknown error', 'Lỗi không rõ'),
      `<button class="ghost-button" type="button" data-action="scan-files">${tt(
        'Try again',
        'Thử lại',
      )}</button>`,
    );
  } else if (!scanning && files.items.length === 0) {
    const idle = files.status === 'idle';
    content += emptyState(
      idle
        ? tt('Find large files', 'Tìm file lớn')
        : tt('No large files found', 'Không tìm thấy file lớn'),
      idle
        ? tt(
            'Scan your home folder for files over {mb} MB that are safe to move to the Trash.',
            'Quét thư mục home để tìm file trên {mb} MB có thể chuyển vào Thùng rác.',
            { mb: files.minMB },
          )
        : tt(
            'Nothing over {mb} MB outside Library folders.',
            'Không có file nào trên {mb} MB ngoài các thư mục Library.',
            { mb: files.minMB },
          ),
      idle
        ? `<button class="ghost-button" type="button" data-action="scan-files">${tt(
            'Scan for large files',
            'Tìm file lớn',
          )}</button>`
        : '',
    );
    if (note) content += `<div class="sheet" style="margin-top:14px">${note}</div>`;
  } else if (files.items.length > 0) {
    content += `<div class="toolbar">
        <div class="search-field">
          ${icon('search')}
          <input class="search-input" id="file-search" type="text" placeholder="${esc(
            tt('Filter by name or folder', 'Lọc theo tên hoặc thư mục'),
          )}" value="${esc(files.query)}" autocomplete="off" spellcheck="false" />
        </div>
        <span class="group-meta" id="file-count">${tt(
          `{n} of {total} ${files.items.length === 1 ? 'file' : 'files'}`,
          '{n}/{total} file',
          { n: formatCount(visible.length), total: formatCount(files.items.length) },
        )}</span>
      </div>
      <div class="sheet" id="file-rows">
        <div class="list-head">
          <span></span><span></span><span>${tt('File', 'File')}</span><span class="right">${tt(
            'Size',
            'Dung lượng',
          )}</span><span class="right">${tt('Modified', 'Sửa lần cuối')}</span><span></span>
        </div>
        ${visible.map(fileRow).join('')}
        ${note}
      </div>
      <p class="footnote">${tt(
        'Removed files go to the Trash and stay recoverable until you empty it.',
        'File bị xoá sẽ vào Thùng rác và có thể khôi phục cho đến khi bạn dọn Thùng rác.',
      )}</p>`;
  }

  els.view.innerHTML =
    hero({
      amount: formatBytes(total),
      line,
      actions,
      loading: scanning && files.items.length === 0,
    }) + content;
}

function fileRow(file) {
  const selected = state.files.selected.has(file.path);
  const search = `${file.name} ${file.dir}`.toLowerCase();
  return `<div class="file-row${selected ? ' is-selected' : ''}" data-row="file" data-path="${esc(
    file.path,
  )}" data-search="${esc(search)}">
      <input class="row-check" type="checkbox" data-select="file" data-path="${esc(
        file.path,
      )}" aria-label="${esc(tt('Select {name}', 'Chọn {name}', { name: file.name }))}" ${
        selected ? 'checked' : ''
      } />
      <span class="file-icon">${icon('file')}</span>
      <div class="file-body">
        <div class="file-name">${esc(file.name)}</div>
        <div class="file-dir" title="${esc(file.path)}">${esc(tilde(file.dir))}</div>
      </div>
      <div class="file-size">${esc(formatBytes(file.bytes))}</div>
      <div class="file-age">${esc(formatAge(file.mtime))}</div>
      <button class="icon-button file-reveal" type="button" data-reveal="${esc(
        file.path,
      )}" aria-label="${esc(tt('Reveal in Finder', 'Mở trong Finder'))}">${icon(
        'arrow-up-right',
      )}</button>
    </div>`;
}

/* ---------- action bar ---------- */

function renderActionbar() {
  if (!state.loaded) {
    els.actionbar.innerHTML = '';
    els.actionbar.classList.remove('is-visible');
    return;
  }

  let html = '';
  let show = false;

  if (state.view === 'projects') {
    const selected = [...state.projects.selected];
    const items = state.projects.items.filter((item) =>
      state.projects.selected.has(item.path),
    );
    const bytes = items.reduce((sum, item) => sum + item.bytes, 0);
    const scanning = state.projects.status === 'scanning';
    show = selected.length > 0;

    if (show) {
      html = `<div class="actionbar-summary">
          <div class="actionbar-size">${esc(formatBytes(bytes))}</div>
          <div class="actionbar-sub">${tt(
            '{n} selected · Deleted permanently',
            '{n} đã chọn · Xoá vĩnh viễn',
            { n: selected.length },
          )}</div>
        </div>
        <div class="actionbar-actions">
          <button class="primary-button is-danger" type="button" data-action="delete-selected" ${
            scanning ? 'disabled' : ''
          }>${tt('Delete', 'Xoá')}</button>
        </div>`;
    }
  } else if (state.view === 'files') {
    const files = state.files.items.filter((file) => state.files.selected.has(file.path));
    const bytes = files.reduce((sum, file) => sum + file.bytes, 0);
    show = files.length > 0;

    if (show) {
      html = `<div class="actionbar-summary">
          <div class="actionbar-size">${esc(formatBytes(bytes))}</div>
          <div class="actionbar-sub">${tt(
            '{n} selected · Moved to the Trash',
            '{n} đã chọn · Chuyển vào Thùng rác',
            { n: files.length },
          )}</div>
        </div>
        <div class="actionbar-actions">
          <button class="primary-button" type="button" data-action="trash-selected">${tt(
            'Move to Trash',
            'Chuyển vào Thùng rác',
          )}</button>
        </div>`;
    }
  } else {
    const ids = selectedTargetIds();
    const bytes = selectedTargetBytes();
    const hasCaution = ids.some((id) => targetById(id)?.risk !== 'safe');
    const running = state.clean.running;
    show = ids.length > 0 || running;

    if (show) {
      const current = running ? targetById(state.clean.currentId) : null;
      let sub;
      if (running) {
        sub = current
          ? tt(
              'Cleaning {name} · {i} of {n}',
              'Đang dọn {name} · {i}/{n}',
              { name: targetName(current), i: state.clean.done + 1, n: state.clean.total },
            )
          : tt('Preparing {n} items…', 'Đang chuẩn bị {n} mục…', { n: state.clean.total });
      } else if (ids.length === 0) {
        sub = tt('Select items to clean', 'Chọn mục để dọn');
      } else if (hasCaution) {
        sub = tt(
          '{n} selected · Some data cannot be rebuilt',
          '{n} đã chọn · Có dữ liệu không thể tạo lại',
          { n: ids.length },
        );
      } else {
        sub = tt(
          '{n} selected · Caches rebuild automatically',
          '{n} đã chọn · Cache tự tạo lại',
          { n: ids.length },
        );
      }

      const progress = running
        ? `<div class="actionbar-progress" aria-hidden="true"><span style="--p:${Math.min(
            1,
            state.clean.done / Math.max(1, state.clean.total),
          ).toFixed(3)}"></span></div>`
        : '';

      html = `${progress}<div class="actionbar-summary">
          <div class="actionbar-size">${esc(formatBytes(bytes))}</div>
          <div class="actionbar-sub">${esc(sub)}</div>
        </div>
        <div class="actionbar-actions">
          <button class="primary-button${hasCaution ? ' is-danger' : ''}" type="button" data-action="clean-selected" ${
            ids.length && !running ? '' : 'disabled'
          }>${
            running
              ? `<span class="spinner"></span>${tt('Cleaning…', 'Đang dọn…')}`
              : tt('Clean up', 'Dọn')
          }</button>
        </div>`;
    }
  }

  els.actionbar.innerHTML = html;
  els.actionbar.classList.toggle('is-visible', show);
}

/* ---------- selection updates ---------- */

function refreshSelectionUI() {
  document.querySelectorAll('.row[data-row="target"]').forEach((row) => {
    const id = row.dataset.id;
    const selected = state.selected.has(id);
    row.classList.toggle('is-selected', selected);
    const box = row.querySelector('input[data-select="target"]');
    if (box) box.checked = selected;
  });

  document.querySelectorAll('[data-group-meta]').forEach((el) => {
    const list = visibleTargets(el.dataset.groupMeta);
    const selected = list.filter((target) => state.selected.has(target.id));
    const selectedBytes = selected.reduce(
      (sum, target) => sum + (sizeOf(target.id)?.bytes || 0),
      0,
    );
    const total = list.reduce((sum, target) => sum + (sizeOf(target.id)?.bytes || 0), 0);
    el.textContent =
      selected.length > 0
        ? `${selected.length} selected · ${formatBytes(selectedBytes)}`
        : formatBytes(total);
  });

  document.querySelectorAll('.file-row').forEach((row) => {
    const key = row.dataset.row === 'project' ? state.projects.selected : state.files.selected;
    const selected = key.has(row.dataset.path);
    row.classList.toggle('is-selected', selected);
    const box = row.querySelector('input[data-select]');
    if (box) box.checked = selected;
  });

  renderActionbar();
}

function setTargetSelected(id, selected) {
  if (selected && !isSelectableTarget(id)) return;
  if (selected) state.selected.add(id);
  else state.selected.delete(id);
}

/* ---------- scanning ---------- */

function applyScanResult(result) {
  const status = result.available === false ? 'unavailable' : 'ready';
  state.sizes.set(result.id, {
    status,
    bytes: Number(result.bytes) || 0,
    note: result.note || '',
    paths: result.paths || [],
    sizes: result.sizes || [],
  });
  if (status !== 'ready' || !result.bytes) state.selected.delete(result.id);
}

async function startScan() {
  if (state.scan.running) return;
  const active = state.targets.filter((target) => state.fullDiskAccess || !target.protected);
  state.scan = { running: true, completed: 0, total: active.length };
  state.sizes.clear();
  render();

  try {
    const result = await api.startScan();
    for (const entry of result.results || []) applyScanResult(entry);
    if (result.disk) state.disk = result.disk;
    if (typeof result.fullDiskAccess === 'boolean') state.fullDiskAccess = result.fullDiskAccess;
  } catch (error) {
    state.banner = {
      kind: 'error',
      title: tt('Scan failed', 'Quét thất bại'),
      sub: error.message,
    };
  } finally {
    for (const target of state.targets) {
      if (!state.sizes.has(target.id)) {
        state.sizes.set(target.id, {
          status: 'unavailable',
          bytes: 0,
          note: 'Not scanned',
          paths: [],
          sizes: [],
        });
        state.selected.delete(target.id);
      }
    }
    state.scan.running = false;
    render();
  }
}

async function startProjectScan() {
  if (state.projects.status === 'scanning') return;
  state.projects.query = '';
  state.projects.status = 'scanning';
  state.projects.error = null;
  state.projects.progress = { done: 0, total: 0 };
  state.projects.selected.clear();
  render();

  try {
    const result = await api.scanProjects();
    if (result.cancelled) {
      state.projects.status = 'idle';
    } else {
      state.projects.status = 'ready';
      state.projects.items = result.items || [];
    }
  } catch (error) {
    state.projects.status = 'error';
    state.projects.error = error.message;
  } finally {
    state.projects.progress = null;
    render();
  }
}

async function startFileScan() {
  if (state.files.status === 'scanning') return;
  state.files.status = 'scanning';
  state.files.error = null;
  state.files.selected.clear();
  render();

  try {
    const result = await api.scanFiles();
    if (typeof result.fullDiskAccess === 'boolean') {
      state.fullDiskAccess = result.fullDiskAccess;
    }
    state.files.exclusions = result.exclusions || [];
    if (result.cancelled) {
      state.files.status = 'idle';
    } else {
      state.files.status = 'ready';
      state.files.items = result.items || [];
      state.files.minMB = result.minMB || state.files.minMB;
    }
  } catch (error) {
    state.files.status = 'error';
    state.files.error = error.message;
  } finally {
    render();
  }
}

function handleRescan() {
  if (!state.loaded || isBusy()) return;
  if (state.view === 'projects') startProjectScan();
  else if (state.view === 'files') startFileScan();
  else startScan();
}

/* ---------- cleaning ---------- */

function openCleanConfirm() {
  const ids = selectedTargetIds();
  if (ids.length === 0 || state.clean.running) return;

  const items = ids.map((id) => ({
    target: targetById(id),
    bytes: sizeOf(id)?.bytes || 0,
  }));
  const bytes = items.reduce((sum, item) => sum + item.bytes, 0);
  const risky = items.filter((item) => item.target.risk !== 'safe');

  const body = `<div class="dialog-list">
      ${items
        .map(
          (item) => `<div class="dialog-item">
            <span class="dialog-item-name">${esc(targetName(item.target))}</span>
            <span class="dialog-item-size">${esc(formatBytes(item.bytes))}</span>
          </div>`,
        )
        .join('')}
    </div>
    ${
      risky.length > 0
        ? `<div class="dialog-warning">${icon('alert-triangle')}
            <span>Not rebuilt automatically: ${esc(
              risky.map((item) => item.target.name).join(', '),
            )}. This cannot be undone.</span></div>`
        : `<div class="dialog-warning" style="border-color:var(--border);background:var(--surface-2)">${icon(
            'check',
          )}<span>Caches and build data are recreated as needed. Files are deleted permanently.</span></div>`
    }`;

  showDialog({
    kind: 'clean',
    ids,
    title: tt('Clean {n} items?', 'Dọn {n} mục?', { n: items.length }),
    sub: tt('{size} will be removed from disk.', '{size} sẽ bị xoá khỏi ổ.', {
      size: formatBytes(bytes),
    }),
    body,
    confirmLabel: tt('Clean up', 'Dọn'),
    danger: risky.length > 0,
  });
}

function openTrashConfirm() {
  const files = state.files.items.filter((file) => state.files.selected.has(file.path));
  if (files.length === 0) return;
  const bytes = files.reduce((sum, file) => sum + file.bytes, 0);
  const shown = files.slice(0, 12);
  const more = files.length - shown.length;

  showDialog({
    kind: 'trash',
    paths: files.map((file) => file.path),
    title: tt('Move {n} files to the Trash?', 'Chuyển {n} file vào Thùng rác?', {
      n: files.length,
    }),
    sub: tt(
      '{size} stays on disk until you empty the Trash.',
      '{size} vẫn chiếm ổ cho đến khi bạn dọn Thùng rác.',
      { size: formatBytes(bytes) },
    ),
    body: `<div class="dialog-list">
        ${shown
          .map(
            (file) => `<div class="dialog-item">
              <span class="dialog-item-name">${esc(file.name)}</span>
              <span class="dialog-item-size">${esc(formatBytes(file.bytes))}</span>
            </div>`,
          )
          .join('')}
        ${more > 0 ? `<div class="dialog-item"><span class="dialog-item-name" style="color:var(--text-3)">${tt('and {n} more', 'và {n} file nữa', { n: more })}</span></div>` : ''}
      </div>
      <div class="dialog-warning" style="border-color:var(--border);background:var(--surface-2)">${icon(
        'check',
      )}<span>${tt(
        'You can restore these files from the Trash until it is emptied.',
        'Bạn có thể khôi phục các file này từ Thùng rác cho đến khi dọn nó.',
      )}</span></div>`,
    confirmLabel: tt('Move to Trash', 'Chuyển vào Thùng rác'),
    danger: false,
  });
}

function openProjectConfirm() {
  const items = state.projects.items.filter((item) => state.projects.selected.has(item.path));
  if (items.length === 0) return;
  const bytes = items.reduce((sum, item) => sum + item.bytes, 0);
  const repos = new Set(items.map((item) => item.repo));

  showDialog({
    kind: 'projects',
    paths: items.map((item) => item.path),
    title: tt('Delete {n} build folders?', 'Xoá {n} thư mục build?', { n: items.length }),
    sub: tt('{size} across {n} projects.', '{size} trong {n} dự án.', {
      size: formatBytes(bytes),
      n: repos.size,
    }),
    body: `<div class="dialog-list">
        ${items
          .slice(0, 12)
          .map(
            (item) => `<div class="dialog-item">
              <span class="dialog-item-name">${esc(item.repo)} / ${esc(item.artifact)}</span>
              <span class="dialog-item-size">${esc(formatBytes(item.bytes))}</span>
            </div>`,
          )
          .join('')}
        ${items.length > 12 ? `<div class="dialog-item"><span class="dialog-item-name" style="color:var(--text-3)">${tt('and {n} more', 'và {n} mục nữa', { n: items.length - 12 })}</span></div>` : ''}
      </div>
      <div class="dialog-warning">${icon('alert-triangle')}<span>${tt(
        'Build folders are deleted permanently. Run your package manager or build again to recreate them.',
        'Thư mục build bị xoá vĩnh viễn. Chạy lại package manager hoặc build để tạo lại.',
      )}</span></div>`,
    confirmLabel: tt('Delete', 'Xoá'),
    danger: true,
  });
}

async function runClean(ids) {
  state.clean = {
    running: true,
    total: ids.length,
    done: 0,
    currentId: null,
    cleaned: new Set(),
  };
  state.banner = null;
  render();

  try {
    await api.runClean(ids);
  } catch (error) {
    state.clean.running = false;
    state.banner = {
      kind: 'error',
      title: tt('Cleanup failed', 'Dọn dẹp thất bại'),
      sub: error.message,
    };
    render();
  }
}

async function trashSelectedFiles() {
  const files = state.files.items.filter((file) => state.files.selected.has(file.path));
  if (files.length === 0) return;
  const sizeByPath = new Map(files.map((file) => [file.path, file.bytes]));

  try {
    const results = await api.trashFiles(files.map((file) => file.path));
    const ok = results.filter((result) => result.ok);
    const failed = results.filter((result) => !result.ok);
    const okPaths = new Set(ok.map((result) => result.path));
    const freed = ok.reduce((sum, result) => sum + (sizeByPath.get(result.path) || 0), 0);

    state.files.items = state.files.items.filter((file) => !okPaths.has(file.path));
    state.files.selected.clear();

    if (ok.length > 0) {
      state.banner = {
        kind: 'success',
        title: tt('Moved {n} files to the Trash', 'Đã chuyển {n} file vào Thùng rác', {
          n: ok.length,
        }),
        sub: tt(
          '{size} will be reclaimed when you empty the Trash.',
          '{size} sẽ được giải phóng khi bạn dọn Thùng rác.',
          { size: formatBytes(freed) },
        ),
      };
    }
    if (failed.length > 0) {
      toast(
        tt('{n} files could not be moved', '{n} file không chuyển được', {
          n: failed.length,
        }),
        'error',
      );
    }
    await refreshDisk();
    render();
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function deleteSelectedProjects() {
  const items = state.projects.items.filter((item) => state.projects.selected.has(item.path));
  if (items.length === 0) return;

  try {
    const results = await api.cleanProjects(items.map((item) => item.path));
    const ok = results.filter((result) => result.ok);
    const failed = results.filter((result) => !result.ok);
    const okPaths = new Set(ok.map((result) => result.path));
    const freed = ok.reduce((sum, result) => sum + (result.freed || 0), 0);

    state.projects.items = state.projects.items.filter((item) => !okPaths.has(item.path));
    state.projects.selected.clear();

    if (ok.length > 0) {
      state.banner = {
        kind: 'success',
        title: tt('Freed', 'Đã giải phóng'),
        amount: freed,
        sub: tt(
          '{n} build folders removed. Run your package manager or build to recreate them.',
          'Đã xoá {n} thư mục build. Chạy lại package manager hoặc build để tạo lại.',
          { n: ok.length },
        ),
      };
    }
    if (failed.length > 0) {
      toast(
        tt('{n} folders could not be removed', '{n} thư mục không xoá được', {
          n: failed.length,
        }),
        'error',
      );
      state.banner = {
        kind: 'error',
        title: tt('Some folders could not be removed', 'Một số thư mục không xoá được'),
        sub: failed[0]?.error || tt('Unknown error', 'Lỗi không rõ'),
      };
    }
    await refreshDisk();
    render();
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function recheckFullDiskAccess() {
  try {
    const info = await api.getState();
    const previous = state.fullDiskAccess;
    state.fullDiskAccess = Boolean(info.fullDiskAccess);
    if (info.disk) state.disk = info.disk;

    if (state.fullDiskAccess !== previous) {
      state.selected = new Set(
        state.targets
          .filter((target) => target.defaultSelected && (state.fullDiskAccess || !target.protected))
          .map((target) => target.id),
      );
      state.sizes.clear();
      state.banner = state.fullDiskAccess
        ? {
            kind: 'success',
            title: tt('Full Disk Access granted', 'Đã cấp Full Disk Access'),
            sub: tt(
              'Caches, logs and Xcode data are now included.',
              'Cache, log và dữ liệu Xcode đã được bao gồm.',
            ),
          }
        : null;
      toast(
        state.fullDiskAccess
          ? tt('Full Disk Access granted', 'Đã cấp Full Disk Access')
          : tt('Full Disk Access is still off', 'Full Disk Access vẫn đang tắt'),
        state.fullDiskAccess ? 'success' : 'error',
      );
      render();
      if (state.view === 'files') startFileScan();
      else if (state.view === 'projects') startProjectScan();
      else startScan();
      return;
    }

    state.banner = {
      kind: 'error',
      title: tt('Full Disk Access is not enabled', 'Full Disk Access chưa được bật'),
      sub: tt(
        'Enable CacheNook in System Settings. When you run it from a terminal, enable the terminal app instead.',
        'Bật CacheNook trong System Settings. Nếu chạy từ terminal, hãy bật cho ứng dụng terminal.',
      ),
    };
    render();
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function refreshDisk() {
  try {
    const info = await api.getState();
    if (info.disk) state.disk = info.disk;
    if (typeof info.fullDiskAccess === 'boolean') state.fullDiskAccess = info.fullDiskAccess;
  } catch {
    // keep the previous reading
  }
}

/* ---------- motion helpers ---------- */

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function animateValue(element, to) {
  if (!element) return;
  if (prefersReducedMotion()) {
    element.textContent = formatBytes(to);
    return;
  }

  const duration = 600;
  const started = performance.now();
  let finished = false;

  const finish = () => {
    if (finished) return;
    finished = true;
    element.textContent = formatBytes(to);
  };

  // rAF stops while the window is occluded. This fallback still lands on the
  // final number when the user comes back.
  const fallback = setTimeout(finish, duration + 300);
  element.textContent = formatBytes(0);

  const step = (now) => {
    if (finished) return;
    const progress = Math.min(1, (now - started) / duration);
    const eased = 1 - (1 - progress) ** 3;
    element.textContent = formatBytes(to * eased);
    if (progress < 1) requestAnimationFrame(step);
    else {
      clearTimeout(fallback);
      finish();
    }
  };

  requestAnimationFrame(step);
}

/* ---------- dialogs ---------- */

function showDialog(config) {
  dialog = config;
  const confirmClass = config.danger ? 'primary-button is-danger' : 'primary-button';
  els.modalRoot.innerHTML = `<div class="overlay" data-overlay>
      <div class="dialog${config.wide ? ' is-wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <h2 class="dialog-title" id="dialog-title">${esc(config.title)}</h2>
        ${config.sub ? `<p class="dialog-sub">${esc(config.sub)}</p>` : ''}
        ${config.body || ''}
        <div class="dialog-actions">
          ${
            config.cancelLabel === null
              ? ''
              : `<button class="ghost-button" type="button" data-dialog="cancel">${esc(
                  config.cancelLabel || tt('Cancel', 'Huỷ'),
                )}</button>`
          }
          <button class="${confirmClass}" type="button" data-dialog="confirm">${esc(
            config.confirmLabel || tt('Confirm', 'Xác nhận'),
          )}</button>
        </div>
      </div>
    </div>`;

  requestAnimationFrame(() => {
    const cancel = els.modalRoot.querySelector('[data-dialog="cancel"]');
    if (cancel) cancel.focus();
  });
}

function closeDialog() {
  dialog = null;
  els.modalRoot.innerHTML = '';
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function nextRunDate(schedule) {
  const now = new Date();
  const date = new Date(now);
  date.setHours(schedule.hour, schedule.minute, 0, 0);
  const diff = (schedule.weekday - date.getDay() + 7) % 7;
  date.setDate(date.getDate() + diff);
  if (date <= now) date.setDate(date.getDate() + 7);
  return date;
}

function formatNextRun(schedule) {
  const date = nextRunDate(schedule);
  const options =
    state.lang === 'vi'
      ? { weekday: 'long', day: 'numeric', month: 'long' }
      : { weekday: 'long', month: 'short', day: 'numeric' };
  return `${date.toLocaleDateString(locale(), options)} ${tt('at', 'lúc')} ${date.toLocaleTimeString(
    locale(),
    { hour: 'numeric', minute: '2-digit' },
  )}`;
}

function scheduleStatusText(installed, schedule, lastRun, days) {
  const time = `${String(schedule.hour).padStart(2, '0')}:${String(schedule.minute).padStart(
    2,
    '0',
  )}`;

  if (!installed) {
    return tt(
      'Off. Turn it on and press Save. When on, it runs {day} at {time} and removes caches from projects with no file changes in {days}+ days.',
      'Đang tắt. Bật và bấm Lưu. Khi bật, nó chạy {day} lúc {time} và dọn cache của dự án không thay đổi trong {days}+ ngày.',
      { day: weekdayName(schedule.weekday), time, days },
    );
  }

  const parts = [tt('Next run {when}.', 'Lần chạy tới {when}.', { when: formatNextRun(schedule) })];
  if (lastRun?.finishedAt) {
    const when = formatRunTime(lastRun.finishedAt);
    if (lastRun.dryRun) {
      parts.push(
        tt('Last preview {when}: {size}.', 'Xem trước gần nhất {when}: {size}.', {
          when,
          size: formatBytes(lastRun.totalFreed || 0),
        }),
      );
    } else if ((lastRun.totalFreed || 0) > 0) {
      parts.push(
        tt(
          'Last run {when}: freed {size} from {n} folders.',
          'Lần chạy gần nhất {when}: giải phóng {size} từ {n} thư mục.',
          {
            when,
            size: formatBytes(lastRun.totalFreed),
            n: lastRun.removed,
          },
        ),
      );
    } else {
      parts.push(
        tt(
          'Last run {when}: nothing to remove.',
          'Lần chạy gần nhất {when}: không có gì để xoá.',
          { when },
        ),
      );
    }
  }
  return parts.join(' ');
}

function weekdayName(index) {
  const en = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const vi = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];
  return (state.lang === 'vi' ? vi : en)[index] || en[index];
}

async function openSettings() {
  try {
    const info = await api.getState();
    if (info.config) state.config = info.config;
    if (info.staleJob) state.staleJob = info.staleJob;
    if (info.history) state.history = info.history;
    if (info.historySummary) state.historySummary = info.historySummary;
    if (info.deep) state.deep = info.deep;
    if (typeof info.loginItem === 'boolean') state.loginItem = info.loginItem;
    if (info.disk) state.disk = info.disk;
  } catch {
    // show the last known state
  }

  const config = state.config || { projectRoots: [], largeFileMinMB: 300 };
  const job = state.staleJob || {};
  const installed = Boolean(job.installed);
  const schedule =
    installed && job.schedule
      ? job.schedule
      : {
          weekday: config.staleWeekday ?? 0,
          hour: config.staleHour ?? 11,
          minute: config.staleMinute ?? 0,
        };
  const time = `${String(schedule.hour).padStart(2, '0')}:${String(schedule.minute).padStart(
    2,
    '0',
  )}`;
  const days = config.staleDays ?? 30;
  const options = WEEKDAYS.map(
    (name, index) =>
      `<option value="${index}" ${index === schedule.weekday ? 'selected' : ''}>${weekdayName(
        index,
      )}</option>`,
  ).join('');
  const disabled = installed ? '' : 'disabled';

  showDialog({
    kind: 'settings',
    wide: true,
    title: tt('Settings', 'Cài đặt'),
    sub: tt('Where to look, and when to tidy up.', 'Chọn nơi quét và thời điểm dọn.'),
    body: `<div class="field">
        <label class="field-label" for="setting-language">${tt('Language', 'Ngôn ngữ')}</label>
        <select class="select" id="setting-language">
          <option value="en" ${config.language !== 'vi' ? 'selected' : ''}>English</option>
          <option value="vi" ${config.language === 'vi' ? 'selected' : ''}>Tiếng Việt</option>
        </select>
      </div>
      <div class="field">
        <div class="field-row">
          <div>
            <span class="field-label">${tt('Open at login', 'Mở khi đăng nhập')}</span>
            <p class="field-hint">${tt(
              'Start CacheNook in the menu bar after you log in.',
              'Khởi động CacheNook trên menu bar sau khi đăng nhập.',
            )}</p>
          </div>
          <label class="switch">
            <input type="checkbox" id="setting-login" ${
              state.loginItem ? 'checked' : ''
            } aria-label="${esc(tt('Open at login', 'Mở khi đăng nhập'))}" />
            <span aria-hidden="true"></span>
          </label>
        </div>
      </div>
      <div class="field">
        <label class="field-label" for="setting-roots">${tt(
          'Project folders',
          'Thư mục dự án',
        )}</label>
        <textarea class="textarea" id="setting-roots" spellcheck="false">${esc(
          (config.projectRoots || []).join('\n'),
        )}</textarea>
        <p class="field-hint">${tt(
          'One absolute path per line. Build folders inside these paths can be cleaned from the Projects view.',
          'Mỗi dòng một đường dẫn tuyệt đối. Các thư mục build bên trong có thể dọn từ tab Dự án.',
        )}</p>
      </div>
      <div class="field">
        <label class="field-label" for="setting-min">${tt(
          'Large file threshold',
          'Ngưỡng file lớn',
        )}</label>
        <div style="display:flex;align-items:center;gap:8px">
          <input class="number-input" id="setting-min" type="number" min="50" max="100000" step="50" value="${esc(
            config.largeFileMinMB,
          )}" />
          <span style="font-size:12px;color:var(--text-3)">${tt(
            'MB and larger',
            'MB trở lên',
          )}</span>
        </div>
      </div>
      <div class="settings-section">
        <div class="field-row">
          <div>
            <span class="field-label">${tt('Automatic cleanup', 'Tự động dọn')}</span>
            <p class="field-hint">${tt(
              'Runs in the background and removes caches from projects you have not touched.',
              'Chạy nền và dọn cache của các dự án bạn không đụng tới.',
            )}</p>
          </div>
          <label class="switch">
            <input type="checkbox" id="setting-auto" ${installed ? 'checked' : ''} aria-label="${esc(
              tt('Enable automatic cleanup', 'Bật tự động dọn'),
            )}" />
            <span aria-hidden="true"></span>
          </label>
        </div>
        <div class="auto-fields${installed ? '' : ' is-off'}" id="auto-fields">
          <div class="schedule-controls">
            <span>${tt('Every', 'Mỗi')}</span>
            <select class="select" id="setting-weekday" ${disabled}>${options}</select>
            <span>${tt('at', 'lúc')}</span>
            <input class="time-input" id="setting-time" type="time" value="${time}" ${disabled} />
            <span class="schedule-sep">·</span>
            <span>${tt('idle for', 'không dùng')}</span>
            <input class="number-input compact" id="setting-stale" type="number" min="7" max="365" step="1" value="${days}" ${disabled} />
            <span>${tt('days', 'ngày')}</span>
          </div>
          <p class="status-line">${scheduleStatusText(
            installed,
            schedule,
            job.lastRun,
            days,
          )}</p>
          <div class="auto-actions">
            <button class="ghost-button" type="button" data-action="preview-stale">${tt(
              'Preview',
              'Xem trước',
            )}</button>
            <button class="text-button" type="button" data-action="show-schedule-log">${tt(
              'Show log',
              'Xem log',
            )}</button>
          </div>
          <details class="advanced-block">
            <summary>${tt('Auto-clean exclusions', 'Loại trừ tự động dọn')}${
              (config.autoCleanIgnore || []).length
                ? ` (${config.autoCleanIgnore.length})`
                : ''
            }</summary>
            <textarea class="textarea compact" id="setting-ignore" spellcheck="false" placeholder="/Users/you/Repositories/a-project">${esc(
              (config.autoCleanIgnore || []).join('\n'),
            )}</textarea>
            <p class="field-hint">${tt(
              'One folder per line. Repos with uncommitted changes or a .cachenookignore file are skipped automatically.',
              'Mỗi dòng một thư mục. Repo có thay đổi chưa commit hoặc file .cachenookignore sẽ tự động được bỏ qua.',
            )}</p>
          </details>
        </div>
      </div>
      <details class="advanced-block">
        <summary>${tt('History', 'Lịch sử')}${
          state.historySummary?.totalRuns
            ? ` · ${formatBytes(state.historySummary.monthFreed)} ${tt('this month', 'tháng này')}`
            : ''
        }</summary>
        ${historyBlock()}
      </details>
      <details class="advanced-block">
        <summary>${tt('Deep clean', 'Dọn sâu')}</summary>
        <div class="deep-actions">
          <button class="text-button" type="button" data-action="review-trash">${tt(
            'Review Trash in Finder',
            'Xem Thùng rác trong Finder',
          )}</button>
          <button class="text-button" type="button" data-action="scan-installers">${tt(
            'Old installers…',
            'Bộ cài cũ…',
          )}</button>
          <button class="text-button" type="button" data-action="delete-snapshots" ${
            state.deep?.snapshots ? '' : 'disabled'
          }>${tt('Delete local snapshots', 'Xoá snapshot cục bộ')}${
            state.deep?.snapshots ? ` (${state.deep.snapshots})` : ''
          }</button>
        </div>
        <p class="field-hint">${tt(
          'Old installers are .dmg, .pkg, .zip or .iso files in Downloads, older than 30 days and over 50 MB.',
          'Bộ cài cũ là file .dmg, .pkg, .zip hoặc .iso trong Downloads, cũ hơn 30 ngày và trên 50 MB.',
        )}</p>
      </details>
      <details class="advanced-block">
        <summary>${tt('Updates', 'Cập nhật')}</summary>
        <div class="update-row">
          <input class="search-input" id="setting-update-url" type="url" placeholder="https://example.com/cachenook.json" value="${esc(
            config.updateUrl || '',
          )}" />
          <button class="ghost-button" type="button" data-action="check-updates">${tt(
            'Check',
            'Kiểm tra',
          )}</button>
        </div>
        <p class="field-hint">${tt(
          'Manifest: {"version":"1.0.1","url":"https://.../CacheNook.dmg","notes":"..."}. Silent install needs a signed build and feed.',
          'Manifest: {"version":"1.0.1","url":"https://.../CacheNook.dmg","notes":"..."}. Cài tự động cần app được ký và feed ký.',
        )}</p>
      </details>
      <p class="field-hint" style="margin-top:16px">CacheNook ${
        state.version ? `v${esc(state.version)}` : ''
      } · ${tt('Everything runs locally, no telemetry.', 'Chạy hoàn toàn cục bộ, không telemetry.')}</p>`,
    confirmLabel: tt('Save', 'Lưu'),
    danger: false,
  });

  requestAnimationFrame(() => {
    const roots = document.getElementById('setting-roots');
    if (roots) roots.focus();
  });
}

function historyBlock() {
  const summary = state.historySummary;
  if (!summary || summary.totalRuns === 0) {
    return `<p class="field-hint">${tt('No cleanups recorded yet.', 'Chưa có lần dọn nào.')}</p>`;
  }

  const rows = state.history
    .slice(0, 4)
    .map((entry) => {
      const date = formatShortDate(new Date(entry.at));
      const source = entry.source === 'scheduled' ? tt('Auto', 'Tự động') : tt('Manual', 'Thủ công');
      const items = entry.items
        ? tt(' · {n} folders', ' · {n} thư mục', { n: entry.items })
        : '';
      return `<div class="history-row"><span>${esc(date)}</span><span>${esc(
        source,
      )}${esc(items)}</span><span>${esc(formatBytes(entry.freed || 0))}</span></div>`;
    })
    .join('');

  return `<p class="field-hint">${tt(
    'This month: {size} across {runs} runs. All time: {total}.',
    'Tháng này: {size} qua {runs} lần. Tổng cộng: {total}.',
    {
      size: formatBytes(summary.monthFreed),
      runs: summary.monthRuns,
      total: formatBytes(summary.totalFreed),
    },
  )}</p><div class="history-list">${rows}</div>`;
}

function readSettingsForm() {
  const rootsField = document.getElementById('setting-roots');
  const minField = document.getElementById('setting-min');
  const languageField = document.getElementById('setting-language');
  const loginField = document.getElementById('setting-login');
  const updateField = document.getElementById('setting-update-url');
  const staleField = document.getElementById('setting-stale');
  const ignoreField = document.getElementById('setting-ignore');
  const autoField = document.getElementById('setting-auto');
  const weekdayField = document.getElementById('setting-weekday');
  const timeField = document.getElementById('setting-time');
  if (!rootsField || !minField) return null;

  const [hour, minute] = (timeField?.value || '11:00').split(':').map(Number);

  return {
    projectRoots: rootsField.value
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
    language: languageField?.value === 'vi' ? 'vi' : 'en',
    updateUrl: updateField?.value.trim() || '',
    loginAtStartup: Boolean(loginField?.checked),
    largeFileMinMB: Number(minField.value),
    staleDays: Number(staleField?.value || 30),
    staleWeekday: Number(weekdayField?.value || 0),
    staleHour: Number.isFinite(hour) ? hour : 11,
    staleMinute: Number.isFinite(minute) ? minute : 0,
    autoCleanIgnore: (ignoreField?.value || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
    enabled: Boolean(autoField?.checked),
  };
}

async function persistSettings({ applySchedule }) {
  const values = readSettingsForm();
  if (!values) throw new Error('Settings are not open');

  const { enabled, ...configValues } = values;
  const config = await api.setConfig(configValues);
  state.config = config;
  state.files.minMB = config.largeFileMinMB;

  if (applySchedule) {
    state.staleJob = await api.setSchedule({
      enabled,
      weekday: values.staleWeekday,
      hour: values.staleHour,
      minute: values.staleMinute,
    });
  }

  return { config, enabled };
}

async function saveSettings() {
  try {
    const previous = state.config || {};
    const { config, enabled } = await persistSettings({ applySchedule: true });
    state.lang = config.language === 'vi' ? 'vi' : 'en';
    applyLanguage();
    const loginField = document.getElementById('setting-login');
    if (loginField) {
      state.loginItem = await api.setLoginItem(loginField.checked);
    }
    const rootsChanged =
      JSON.stringify(previous.projectRoots || []) !== JSON.stringify(config.projectRoots || []);
    if (rootsChanged) {
      state.projects.status = 'idle';
      state.projects.items = [];
      state.projects.selected.clear();
      state.projects.query = '';
    }
    if (previous.largeFileMinMB !== config.largeFileMinMB) {
      state.files.status = 'idle';
      state.files.items = [];
      state.files.selected.clear();
    }
    closeDialog();
    toast(
    enabled
      ? tt('Settings saved · automatic cleanup on', 'Đã lưu · tự động dọn đang bật')
      : tt('Settings saved · automatic cleanup off', 'Đã lưu · tự động dọn đang tắt'),
  );
    render();
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function previewStaleCleanup() {
  const button = document.querySelector('[data-action="preview-stale"]');
  try {
    await persistSettings({ applySchedule: false });
    if (button) {
      button.disabled = true;
      button.textContent = 'Checking…';
    }
    toast(tt('Checking project folders…', 'Đang kiểm tra thư mục dự án…'));

    const result = await api.runStaleJob(false);
    state.staleJob = result.status;
    openStalePreview(result.summary);
  } catch (error) {
    toast(error.message, 'error');
    if (button) {
      button.disabled = false;
      button.textContent = 'Preview';
    }
  }
}

function openStalePreview(summary) {
  const items = summary.removed || [];
  const shown = items.slice(0, 20);
  const body =
    items.length > 0
      ? `<div class="dialog-list">
          ${shown
            .map(
              (item) => `<div class="dialog-item">
                <span class="dialog-item-name" title="${esc(item.path)}">${esc(
                  `${item.repo} / ${item.artifact}`,
                )}</span>
                <span class="dialog-item-size">${esc(formatBytes(item.bytes))}</span>
              </div>`,
            )
            .join('')}
          ${
            items.length > shown.length
              ? `<div class="dialog-item"><span class="dialog-item-name" style="color:var(--text-3)">${tt('and {n} more', 'và {n} mục nữa', { n: items.length - shown.length })}</span></div>`
              : ''
          }
        </div>
        <div class="dialog-warning" style="border-color:var(--border);background:var(--surface-2)">${icon(
          'check',
        )}<span>${tt(
          'Only known cache folders are removed. dist, build and out are never touched.',
          'Chỉ các thư mục cache đã biết bị xoá. dist, build và out không bao giờ bị đụng.',
        )}</span></div>`
      : '';

  showDialog({
    kind: 'stale-preview',
    summary,
    wide: true,
    title:
      items.length > 0
        ? tt('Stale build folders', 'Thư mục build cũ')
        : tt('Nothing to clean', 'Không có gì để dọn'),
    sub:
      items.length > 0
        ? tt(
            `{size} in {n} ${items.length === 1 ? 'folder' : 'folders'} with no activity for {days}+ days.`,
            '{size} trong {n} thư mục không hoạt động {days}+ ngày.',
            { size: formatBytes(summary.totalFreed), n: items.length, days: summary.days },
          )
        : tt(
            'No cache folder has been inactive for {days}+ days.',
            'Không có thư mục cache nào không hoạt động {days}+ ngày.',
            { days: summary.days },
          ),
    body,
    confirmLabel:
      items.length > 0 ? tt('Clean now', 'Dọn ngay') : tt('Close', 'Đóng'),
    cancelLabel: items.length > 0 ? tt('Cancel', 'Huỷ') : null,
    danger: items.length > 0,
  });
}

function openSnapshotConfirm() {
  const count = state.deep?.snapshots || 0;
  if (count === 0) return;
  showDialog({
    kind: 'deep-snapshots',
    title: tt('Delete {n} local snapshots?', 'Xoá {n} snapshot cục bộ?', { n: count }),
    sub: tt(
      'macOS recreates local snapshots as needed. Time Machine backups are not affected.',
      'macOS sẽ tạo lại snapshot cục bộ khi cần. Backup Time Machine không bị ảnh hưởng.',
    ),
    confirmLabel: tt('Delete snapshots', 'Xoá snapshot'),
    danger: true,
  });
}

async function deleteSnapshots() {
  try {
    toast(tt('Deleting local snapshots…', 'Đang xoá snapshot cục bộ…'));
    const result = await api.deleteSnapshots();
    state.deep = { ...state.deep, snapshots: result.remaining };
    if (result.deleted > 0) {
      toast(
        tt('Deleted {n} local snapshots', 'Đã xoá {n} snapshot cục bộ', {
          n: result.deleted,
        }),
      );
    }
    if (result.errors.length > 0) {
      toast(
        result.errors[0].message ||
          tt('Some snapshots could not be deleted', 'Một số snapshot không xoá được'),
        'error',
      );
    }
    render();
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function checkForUpdates() {
  const field = document.getElementById('setting-update-url');
  const override = field ? field.value.trim() : '';

  try {
    toast(tt('Checking for updates…', 'Đang kiểm tra cập nhật…'));
    const result = await api.checkUpdates(override || undefined);

    if (!result.configured) {
      showDialog({
        kind: 'details',
        title: tt('Updates not configured', 'Chưa cấu hình cập nhật'),
        sub: tt(
          'Add a manifest URL in Settings > Updates.',
          'Thêm URL manifest trong Cài đặt > Cập nhật.',
        ),
        confirmLabel: tt('Close', 'Đóng'),
        cancelLabel: null,
        danger: false,
      });
      return;
    }

    if (result.available) {
      showDialog({
        kind: 'update-available',
        update: result,
        wide: true,
        title: tt('Version {version} is available', 'Đã có phiên bản {version}', {
          version: result.latest,
        }),
        sub:
          result.notes ||
          tt('You have {current}.', 'Bạn đang dùng {current}.', { current: result.current }),
        body: result.url
          ? `<p class="field-hint" style="word-break:break-all">${esc(result.url)}</p>`
          : '',
        confirmLabel: result.url ? tt('Download', 'Tải về') : tt('Close', 'Đóng'),
        danger: false,
      });
      return;
    }

    showDialog({
      kind: 'details',
      title: tt('You are up to date', 'Bạn đang dùng bản mới nhất'),
      sub: tt('CacheNook {version} is the latest version.', 'CacheNook {version} là bản mới nhất.', {
        version: result.current,
      }),
      confirmLabel: tt('Close', 'Đóng'),
      cancelLabel: null,
      danger: false,
    });
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function toggleProjectIgnore(repoPath) {
  if (!repoPath) return;
  const list = new Set(state.config?.autoCleanIgnore || []);
  const nowIgnored = !list.has(repoPath);
  if (nowIgnored) list.add(repoPath);
  else list.delete(repoPath);

  try {
    const config = await api.setConfig({ ...state.config, autoCleanIgnore: [...list] });
    state.config = config;
    render();
    toast(
      nowIgnored
        ? tt('Auto-clean disabled for this project', 'Đã tắt tự dọn cho dự án này')
        : tt('Auto-clean enabled for this project', 'Đã bật tự dọn cho dự án này'),
    );
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function reviewInstallers() {
  try {
    toast(tt('Looking for old installers…', 'Đang tìm bộ cài cũ…'));
    const result = await api.scanInstallers();
    if (result.items.length === 0) {
      showDialog({
        kind: 'details',
        title: tt('No old installers', 'Không có bộ cài cũ'),
        sub: tt(
          'No .dmg, .pkg, .zip or .iso file over 50 MB in Downloads is older than 30 days.',
          'Không có file .dmg, .pkg, .zip hoặc .iso trên 50 MB trong Downloads cũ hơn 30 ngày.',
        ),
        confirmLabel: tt('Close', 'Đóng'),
        cancelLabel: null,
        danger: false,
      });
      return;
    }

    showDialog({
      kind: 'deep-installers',
      items: result.items,
      wide: true,
      title: tt('Old installers', 'Bộ cài cũ'),
      sub: tt('{size} in {n} files older than 30 days.', '{size} trong {n} file cũ hơn 30 ngày.', {
        size: formatBytes(result.totalBytes),
        n: result.items.length,
      }),
      body: `<div class="dialog-list">${result.items
        .slice(0, 20)
        .map(
          (item) => `<div class="dialog-item">
            <span class="dialog-item-name" title="${esc(item.path)}">${esc(item.name)}</span>
            <span class="dialog-item-size">${esc(formatBytes(item.bytes))}</span>
          </div>`,
        )
        .join('')}</div>`,
      confirmLabel: tt('Move to Trash', 'Chuyển vào Thùng rác'),
      danger: false,
    });
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function trashInstallers(items) {
  try {
    const results = await api.trashFiles(items.map((item) => item.path));
    const ok = results.filter((result) => result.ok).length;
    if (ok > 0) {
      toast(tt('Moved {n} installers to the Trash', 'Đã chuyển {n} bộ cài vào Thùng rác', { n: ok }));
    }
    const failed = results.filter((result) => !result.ok);
    if (failed.length > 0) {
      toast(
        failed[0].error || tt('Some installers could not be moved', 'Một số bộ cài không chuyển được'),
        'error',
      );
    }
    render();
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function applyStaleCleanup() {
  try {
    toast(tt('Cleaning stale folders…', 'Đang dọn thư mục cũ…'));
    const result = await api.runStaleJob(true);
    state.staleJob = result.status;
    state.projects.status = 'idle';
    state.projects.items = [];
    state.projects.selected.clear();

    const freed = result.summary.totalFreed || 0;
    state.banner = {
      kind: 'success',
      title: freed > 0 ? tt('Freed', 'Đã giải phóng') : tt('Nothing to clean', 'Không có gì để dọn'),
      amount: freed > 0 ? freed : null,
      sub:
        freed > 0
          ? tt('{n} stale folders removed.', 'Đã xoá {n} thư mục cũ.', {
              n: result.summary.removed.length,
            })
          : tt('No stale folders were found.', 'Không tìm thấy thư mục cũ.'),
      details: result.summary.errors?.length ? result.summary.errors : null,
    };

    if (result.summary.errors?.length) {
      toast(
        tt('{n} folders could not be removed', '{n} thư mục không xoá được', {
          n: result.summary.errors.length,
        }),
        'error',
      );
    }

    render();
  } catch (error) {
    toast(error.message, 'error');
  }
}

function openErrorDetails() {
  const details = state.banner?.details || [];
  showDialog({
    kind: 'details',
    title: tt('Items that were skipped', 'Mục bị bỏ qua'),
    sub: tt('These paths could not be removed.', 'Không thể xoá các đường dẫn này.'),
    body: `<div class="dialog-list">${details
      .map(
        (detail) => `<div class="dialog-item">
          <span class="dialog-item-name" title="${esc(detail.path)}">${esc(
            detail.path || 'Unknown path',
          )}</span>
          <span class="dialog-item-size" style="color:var(--danger)">${esc(detail.message)}</span>
        </div>`,
      )
      .join('')}</div>`,
    confirmLabel: tt('Close', 'Đóng'),
    cancelLabel: null,
    danger: false,
  });
}

/* ---------- toasts ---------- */

function toast(message, kind = 'success') {
  const el = document.createElement('div');
  el.className = `toast${kind === 'error' ? ' is-error' : ''}`;
  el.innerHTML = `${icon(kind === 'error' ? 'alert-triangle' : 'circle-check')}<span>${esc(
    message,
  )}</span>`;
  els.toastRoot.appendChild(el);
  while (els.toastRoot.children.length > 3) {
    els.toastRoot.removeChild(els.toastRoot.firstElementChild);
  }
  setTimeout(() => el.remove(), 4200);
}

/* ---------- events ---------- */

function setView(view) {
  if (state.view === view) return;
  state.view = view;
  render();
  els.view.classList.remove('view-enter');
  void els.view.offsetWidth;
  els.view.classList.add('view-enter');
  els.scroll.scrollTop = 0;

  if (view === 'projects' && state.projects.status === 'idle' && state.projects.items.length === 0) {
    startProjectScan();
  }
  if (view === 'files' && state.files.status === 'idle' && state.files.items.length === 0) {
    startFileScan();
  }
}

function onDocumentClick(event) {
  const tab = event.target.closest('.tab[data-view]');
  if (tab) {
    setView(tab.dataset.view);
    return;
  }

  if (event.target.closest('#settings-button')) {
    openSettings();
    return;
  }

  if (event.target.closest('#rescan-button')) {
    if (state.scan.running) {
      api.cancelScan().catch((error) => toast(error.message, 'error'));
      return;
    }
    if (state.projects.status === 'scanning') {
      api.cancelProjects().catch((error) => toast(error.message, 'error'));
      return;
    }
    if (state.files.status === 'scanning') {
      api.cancelFiles().catch((error) => toast(error.message, 'error'));
      return;
    }
    handleRescan();
    return;
  }

  if (event.target.closest('[data-overlay]') === event.target) {
    closeDialog();
    return;
  }

  const dialogButton = event.target.closest('[data-dialog]');
  if (dialogButton) {
    const action = dialogButton.dataset.dialog;
    if (action === 'cancel') {
      closeDialog();
      return;
    }
    if (action === 'confirm' && dialog) {
      const current = dialog;
      if (current.kind === 'settings') {
        saveSettings();
        return;
      }
      closeDialog();
      if (current.kind === 'clean') runClean(current.ids);
      else if (current.kind === 'trash') trashSelectedFiles();
      else if (current.kind === 'projects') deleteSelectedProjects();
      else if (current.kind === 'stale-preview' && current.summary.removed?.length) {
        applyStaleCleanup();
      } else if (current.kind === 'deep-snapshots') {
        deleteSnapshots();
      } else if (current.kind === 'deep-installers') {
        trashInstallers(current.items);
      } else if (current.kind === 'update-available' && current.update.url) {
        api.openUpdate(current.update.url).catch((error) => toast(error.message, 'error'));
      }
      return;
    }
  }

  const reveal = event.target.closest('[data-reveal]');
  if (reveal) {
    api.reveal(reveal.dataset.reveal).catch((error) => toast(error.message, 'error'));
    return;
  }

  const expand = event.target.closest('[data-expand]');
  if (expand) {
    const id = expand.dataset.expand;
    if (state.expanded.has(id)) state.expanded.delete(id);
    else state.expanded.add(id);
    render();
    return;
  }

  const action = event.target.closest('[data-action]');
  if (action) {
    const name = action.dataset.action;
    if (name === 'banner-close') {
      state.banner = null;
      renderBanner();
    } else if (name === 'banner-details') {
      openErrorDetails();
    } else if (name === 'clean-selected') {
      openCleanConfirm();
    } else if (name === 'trash-selected') {
      openTrashConfirm();
    } else if (name === 'delete-selected') {
      openProjectConfirm();
    } else if (name === 'scan-projects') {
      startProjectScan();
    } else if (name === 'cancel-projects') {
      api.cancelProjects().catch(() => {});
    } else if (name === 'scan-files') {
      startFileScan();
    } else if (name === 'cancel-files') {
      api.cancelFiles().catch(() => {});
    } else if (name === 'open-settings') {
      openSettings();
    } else if (name === 'select-safe') {
      for (const target of currentViewTargets()) {
        const size = sizeOf(target.id);
        if (size?.status === 'ready' && size.bytes > 0 && target.risk === 'safe') {
          state.selected.add(target.id);
        }
      }
      render();
    } else if (name === 'select-none') {
      state.selected.clear();
      render();
    } else if (name === 'retry-init') {
      state.loadError = null;
      init();
    } else if (name === 'open-fda') {
      api.openFullDiskAccess().catch((error) => toast(error.message, 'error'));
    } else if (name === 'recheck-fda') {
      recheckFullDiskAccess();
    } else if (name === 'preview-stale') {
      previewStaleCleanup();
    } else if (name === 'show-schedule-log') {
      api.showScheduleLog().catch((error) => toast(error.message, 'error'));
    } else if (name === 'review-trash') {
      api.openTrash().catch((error) => toast(error.message, 'error'));
    } else if (name === 'scan-installers') {
      reviewInstallers();
    } else if (name === 'delete-snapshots') {
      openSnapshotConfirm();
    } else if (name === 'check-updates') {
      checkForUpdates();
    } else if (name === 'toggle-ignore') {
      toggleProjectIgnore(action.dataset.repo);
    }
    return;
  }

  const row = event.target.closest('[data-row]');
  if (row && !event.target.closest('input, button')) {
    const kind = row.dataset.row;
    if (kind === 'target') {
      if (state.clean.running) return;
      const id = row.dataset.id;
      if (isSelectableTarget(id)) {
        setTargetSelected(id, !state.selected.has(id));
        refreshSelectionUI();
      }
    } else if (kind === 'file') {
      const path = row.dataset.path;
      if (state.files.selected.has(path)) state.files.selected.delete(path);
      else state.files.selected.add(path);
      refreshSelectionUI();
    } else if (kind === 'project') {
      const path = row.dataset.path;
      if (state.projects.selected.has(path)) state.projects.selected.delete(path);
      else state.projects.selected.add(path);
      refreshSelectionUI();
    }
  }
}

function onDocumentChange(event) {
  if (event.target.id === 'setting-auto') {
    const enabled = event.target.checked;
    const fields = document.getElementById('auto-fields');
    if (fields) {
      fields.classList.toggle('is-off', !enabled);
      fields.querySelectorAll('select, input').forEach((input) => {
        input.disabled = !enabled;
      });
    }
    return;
  }

  const box = event.target.closest('input[data-select]');
  if (!box) return;
  const kind = box.dataset.select;

  if (kind === 'target') {
    if (state.clean.running) {
      box.checked = state.selected.has(box.dataset.id);
      return;
    }
    const id = box.dataset.id;
    if (box.checked && !isSelectableTarget(id)) {
      box.checked = false;
      return;
    }
    setTargetSelected(id, box.checked);
    refreshSelectionUI();
    return;
  }

  if (kind === 'file') {
    const path = box.dataset.path;
    if (box.checked) state.files.selected.add(path);
    else state.files.selected.delete(path);
    refreshSelectionUI();
    return;
  }

  if (kind === 'project') {
    const path = box.dataset.path;
    if (box.checked) state.projects.selected.add(path);
    else state.projects.selected.delete(path);
    refreshSelectionUI();
  }
}

function onDocumentInput(event) {
  if (event.target.id === 'project-search') {
    state.projects.query = event.target.value;
    render();
    return;
  }

  if (event.target.id !== 'file-search') return;
  const query = event.target.value;
  state.files.query = query;
  const needle = query.trim().toLowerCase();
  let shown = 0;

  document.querySelectorAll('#file-rows .file-row').forEach((row) => {
    const match = !needle || (row.dataset.search || '').includes(needle);
    row.hidden = !match;
    if (match) shown += 1;
  });

  const count = document.getElementById('file-count');
  if (count) {
    count.textContent = tt('{n} of {total} files', '{n}/{total} file', {
      n: formatCount(shown),
      total: formatCount(state.files.items.length),
    });
  }
}

function onDocumentKeydown(event) {
  if (event.key === 'Escape') {
    if (dialog) {
      event.preventDefault();
      closeDialog();
    }
    return;
  }

  if (event.metaKey && event.key.toLowerCase() === 'r') {
    event.preventDefault();
    handleRescan();
  }
}

/* ---------- events from main ---------- */

function subscribe() {
  api.onScanEvent((event) => {
    if (event.type === 'start') {
      state.scan = { running: true, completed: 0, total: event.total || state.targets.length };
      scheduleRender();
      return;
    }
    if (event.type === 'target') {
      applyScanResult(event.result);
      state.scan.completed = event.completed;
      state.scan.total = event.total;
      scheduleRender();
      return;
    }
    if (event.type === 'done') {
      state.scan.running = false;
      state.scan.completed = state.scan.total;
      if (event.disk) state.disk = event.disk;
      if (typeof event.fullDiskAccess === 'boolean') state.fullDiskAccess = event.fullDiskAccess;
      scheduleRender();
    }
  });

  api.onCleanEvent((event) => {
    if (event.type === 'start') {
      state.clean.running = true;
      state.clean.total = event.ids.length;
      state.clean.done = 0;
      state.clean.currentId = null;
      state.clean.cleaned = new Set();
      scheduleRender();
      return;
    }
    if (event.type === 'progress') {
      state.clean.currentId = event.id;
      scheduleRender();
      return;
    }
    if (event.type === 'done') {
      state.clean.done += 1;
      state.clean.currentId = null;
      state.clean.cleaned.add(event.id);
      scheduleRender();
      return;
    }
    if (event.type === 'finished') {
      state.clean.running = false;
      state.clean.currentId = null;
      state.selected.clear();
      if (event.disk) state.disk = event.disk;

      const errors = (event.results || []).reduce(
        (sum, result) => sum + (result.errorCount || 0),
        0,
      );
      const details = (event.results || []).flatMap((result) => result.errors || []);
      const freed = event.freed || 0;

      state.banner = {
        kind: 'success',
        title: freed > 0 ? tt('Freed', 'Đã giải phóng') : tt('Cleanup finished', 'Đã dọn xong'),
        amount: freed > 0 ? freed : null,
        sub:
          freed > 0
            ? tt(
                '{n} locations cleaned.',
                'Đã dọn {n} vị trí.',
                { n: event.results.length },
              ) +
              (errors > 0
                ? tt(' · {n} items skipped', ' · {n} mục bị bỏ qua', { n: errors })
                : '')
            : errors > 0
              ? tt(
                  'Nothing could be removed. Close apps that use these files and try again.',
                  'Không xoá được gì. Đóng ứng dụng đang dùng các file này rồi thử lại.',
                )
              : tt('There was nothing to remove.', 'Không có gì để xoá.'),
        details: errors > 0 ? details : null,
      };

      scheduleRender();
      setTimeout(() => {
        if (!state.scan.running && isCleanView()) startScan();
      }, 900);
    }
  });

  api.onProjectsEvent((event) => {
    if (event.type === 'progress') {
      state.projects.progress = { done: event.done, total: event.total };
      const text = document.getElementById('project-progress-text');
      const fill = document.getElementById('project-progress-fill');
      const total = event.total || 0;
      const pct = total > 0 ? Math.min(100, (event.done / total) * 100) : 0;
      if (text) {
        text.textContent = `Measuring ${formatCount(event.done)} of ${formatCount(total)} folders…`;
      }
      if (fill) fill.style.width = `${pct.toFixed(1)}%`;
    }
  });

  api.onFilesEvent((event) => {
    if (event.type === 'start') {
      state.files.minMB = event.minMB || state.files.minMB;
    }
  });

  api.onOpenSettings(() => {
    openSettings();
  });

  api.onScanNow(() => {
    handleRescan();
  });

  api.onCheckUpdates(() => {
    checkForUpdates();
  });
}

/* ---------- init ---------- */

async function init() {
  try {
    const info = await api.getState();
    state.home = info.home || '';
    state.version = info.version || '';
    state.lang = info.config?.language === 'vi' ? 'vi' : 'en';
    state.config = info.config;
    state.configPath = info.configPath || '';
    state.disk = info.disk;
    state.fullDiskAccess = Boolean(info.fullDiskAccess);
    state.staleJob = info.staleJob || null;
    state.history = info.history || [];
    state.historySummary = info.historySummary || null;
    state.deep = info.deep || { snapshots: 0 };
    state.loginItem = Boolean(info.loginItem);
    state.targets = info.targets || [];
    state.files.minMB = info.config?.largeFileMinMB || 300;
    state.selected = new Set(
      state.targets.filter((target) => target.defaultSelected).map((target) => target.id),
    );
    state.loaded = true;
    state.loadError = null;
    applyLanguage();
    render();
    startScan();
  } catch (error) {
    state.loadError = error.message;
    state.loaded = false;
    render();
  }
}

document.addEventListener('click', onDocumentClick);
document.addEventListener('change', onDocumentChange);
document.addEventListener('input', onDocumentInput);
document.addEventListener('keydown', onDocumentKeydown);

subscribe();
init();
