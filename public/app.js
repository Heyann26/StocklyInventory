const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const money = n => new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(n || 0);
const dateShort = value => new Intl.DateTimeFormat('id-ID',{day:'2-digit',month:'short',year:'numeric'}).format(new Date(value));
const timeAgo = value => {
  const diff = Date.now() - new Date(value).getTime();
  const mins = Math.max(0, Math.floor(diff / 60000));
  if (mins < 1) return 'Baru saja';
  if (mins < 60) return `${mins} mnt lalu`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h} jam lalu`;
  const d = Math.floor(h / 24);
  return `${d} hari lalu`;
};
const esc = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icons = ['☕','🍵','🍯','🥣','🥥','🍫','🥛','🌾','📦','🫙'];

let dashboard = { products: [], sessions: [], activities: [], movements: [], approvals: [], locations: [], stats: {} };
let toastTimer;
let currentUser = null, authMode = 'login', serviceWorkerRegistration = null;

// Filter States
let activeDateRange = 'today';
let customDateStart = '';
let customDateEnd = '';
let activeLocation = '';
let activeExpFilter = 'all'; // 'all' (<60d) or 'urgent' (<30d)
let activeMoversTab = 'top'; // 'top' or 'worst'

async function api(url, options = {}) {
  const token = localStorage.getItem('stokly_token');
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const response = await fetch(url, {
    credentials: options.credentials || 'include',
    ...options,
    headers
  });
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && !url.includes('/api/auth/status') && !url.includes('/api/auth/login')) {
      if (currentUser) {
        localStorage.removeItem('stokly_token');
        currentUser = null;
        document.body.classList.add('auth-required');
        if ($('#authScreen')) $('#authScreen').hidden = false;
        showAuthMessage('Sesi Anda berakhir. Silakan masuk kembali.');
      }
    }
    throw new Error(data?.error || 'Permintaan gagal.');
  }
  return data;
}

function toast(message) {
  const node = $('#toast');
  if (!node) return;
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('show'), 3000);
}

function stockStatus(p) {
  if (Number(p.stock) === 0) return ['Habis', 'empty'];
  if (Number(p.stock) <= Number(p.minStock ?? 10)) return ['Menipis', 'low'];
  return ['Tersedia', 'ok'];
}

function formatStock(p) {
  const [, state] = stockStatus(p);
  return `<span class="${state === 'ok' ? '' : 'stock-low'} font-medium">${Number(p.stock).toLocaleString('id-ID')} ${esc(p.unit)}</span>`;
}

function productName(p) {
  return `<div class="product-name"><span class="product-thumb"><svg class="w-3.5 h-3.5 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg></span><span class="font-semibold text-gray-900">${esc(p.name)}</span></div>`;
}

function badge(p) {
  const [label, state] = stockStatus(p);
  return `<span class="badge ${state === 'ok' ? 'ok' : 'low'}">${label}</span>`;
}

function isDateInRange(dateValue) {
  if (!dateValue) return false;
  const target = new Date(dateValue).getTime();
  const now = new Date();
  
  if (activeDateRange === 'today') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const end = start + 86400000;
    return target >= start && target < end;
  }
  if (activeDateRange === '7d') {
    const start = now.getTime() - 7 * 86400000;
    return target >= start && target <= now.getTime();
  }
  if (activeDateRange === 'month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    return target >= start && target <= now.getTime();
  }
  if (activeDateRange === 'ytd') {
    const start = new Date(now.getFullYear(), 0, 1).getTime();
    return target >= start && target <= now.getTime();
  }
  if (activeDateRange === 'custom') {
    const start = customDateStart ? new Date(customDateStart).getTime() : 0;
    const end = customDateEnd ? new Date(customDateEnd).getTime() + 86400000 : Infinity;
    return target >= start && target <= end;
  }
  return true;
}

function renderOverview() {
  const { products = [], sessions = [], activities = [], approvals = [] } = dashboard;
  
  // 1. Filter products by active location
  const filteredProducts = activeLocation 
    ? products.filter(p => (p.location || '').toLowerCase().includes(activeLocation.toLowerCase()))
    : products;

  // 2. Filter sessions by date and location
  const filteredSessions = sessions.filter(s => {
    const matchLoc = !activeLocation || (s.location || '').toLowerCase().includes(activeLocation.toLowerCase());
    const matchDate = isDateInRange(s.date || s.createdAt);
    return matchLoc && matchDate;
  });

  // Calculate dynamic stats
  const value = filteredProducts.reduce((s, p) => s + (p.stock * p.cost), 0);
  const lowStock = filteredProducts.filter(p => p.stock <= (p.minStock ?? 10) && p.stock > 0).length;
  const outOfStock = filteredProducts.filter(p => p.stock === 0).length;
  const availableUnits = filteredProducts.reduce((s, p) => s + p.stock, 0);
  const activeSessionsCount = sessions.filter(s => s.status === 'Berlangsung').length;
  const checkedInDateRange = filteredSessions.reduce((a, s) => a + (s.itemsChecked || 0), 0);

  const distinctCategories = new Set(filteredProducts.map(p => p.category)).size;
  const unconfirmedCount = filteredProducts.filter(p => p.stock === 0 || !p.lastCounted).length;
  
  // Real activity metrics based on approvals & outbound movements
  const pendingToPack = approvals
    .filter(a => a.status === 'pending' && a.type === 'transfer')
    .reduce((s, a) => s + (Number(a.quantity) || 0), 0);

  const readyToShip = approvals
    .filter(a => a.status === 'approved' && a.type === 'transfer')
    .length;

  const inTransitShipments = approvals
    .filter(a => (a.status === 'in_transit' || a.status === 'shipping') && a.type === 'transfer')
    .length;

  const outboundInvoiced = (dashboard.movements || []).filter(m => {
    return isDateInRange(m.createdAt) && (Number(m.delta) < 0);
  }).length;

  // Update Zoho KPI Stat Cards with actual data (0 if none)
  // 1. TO BE PACKED: Pending transfer units waiting to be packed
  if ($('#statChecked')) $('#statChecked').textContent = pendingToPack.toLocaleString('id-ID');
  // 2. TO BE SHIPPED: Approved packages ready to ship
  if ($('#statLow')) $('#statLow').textContent = readyToShip.toLocaleString('id-ID');
  // 3. TO BE DELIVERED: Transfers / packages currently in delivery
  if ($('#statSessions')) $('#statSessions').textContent = inTransitShipments.toLocaleString('id-ID');
  // 4. TO BE INVOICED: Outbound distribution / sales movements recorded
  if ($('#statToBeInvoiced')) $('#statToBeInvoiced').textContent = outboundInvoiced.toLocaleString('id-ID');

  // Inventory Summary
  // STOK FISIK TERSEDIA: Real sum of product stock
  if ($('#statAvailable')) $('#statAvailable').textContent = availableUnits.toLocaleString('id-ID');
  // PESANAN MENUNGGU MASUK: Pending incoming purchase/restock order approvals
  const pendingIncomingCount = approvals
    .filter(a => a.status === 'pending' && (!a.type || a.type === 'order' || a.type === 'restock'))
    .reduce((s, a) => s + (Number(a.quantity) || 0), 0);
  if ($('#statToBeReceived')) $('#statToBeReceived').textContent = pendingIncomingCount.toLocaleString('id-ID');

  // Product Details
  if ($('#prodLowStock')) $('#prodLowStock').textContent = lowStock.toLocaleString('id-ID');
  if ($('#prodAllGroups')) $('#prodAllGroups').textContent = distinctCategories.toLocaleString('id-ID');
  if ($('#statProducts')) $('#statProducts').textContent = filteredProducts.length.toLocaleString('id-ID');
  if ($('#prodUnconfirmed')) $('#prodUnconfirmed').textContent = unconfirmedCount.toLocaleString('id-ID');

  // Active items percentage ring (products with stock > 0)
  const activeItemsCount = filteredProducts.filter(p => Number(p.stock) > 0).length;
  const activePct = filteredProducts.length > 0 ? Math.round((activeItemsCount / filteredProducts.length) * 100) : 0;
  if ($('#zohoActivePct')) $('#zohoActivePct').textContent = `${activePct}%`;
  if ($('#zohoDonutArc')) {
    const circumference = 2 * Math.PI * 38; // ~238.76
    const offset = circumference - (activePct / 100) * circumference;
    $('#zohoDonutArc').style.strokeDasharray = `${circumference}`;
    $('#zohoDonutArc').style.strokeDashoffset = `${offset}`;
  }
  if ($('#zohoActiveCount')) $('#zohoActiveCount').textContent = `${activeItemsCount} dari ${filteredProducts.length} produk`;

  // Fallback hidden elements
  if ($('#statValue')) $('#statValue').textContent = money(value);
  if ($('#statOut')) $('#statOut').textContent = outOfStock.toLocaleString('id-ID');

  if ($('#navProductCount')) $('#navProductCount').textContent = products.length || 0;
  if ($('#navSessionCount')) $('#navSessionCount').textContent = activeSessionsCount;

  // Render Sub-widgets
  renderExpiringSoon(filteredProducts);
  renderPendingApprovals(approvals);
  renderTopSellingItems(filteredProducts);
  renderSalesOrdersTable(filteredProducts);
  renderSessionList(sessions);
  renderActivityAuditTrail();
  populateLocationFilter();
}

function renderTopSellingItems(products) {
  const container = $('#topSellingContainer');
  if (!container) return;

  if (!products.length) {
    container.innerHTML = `<div class="col-span-2 p-6 text-center text-xs text-gray-400 font-medium bg-gray-50 rounded">Belum ada produk terdaftar.</div>`;
    return;
  }

  // Calculate actual sales from outbound movements
  const productSales = products.map(p => {
    const outbound = (dashboard.movements || [])
      .filter(m => m.productId === p.id && Number(m.delta) < 0)
      .reduce((sum, m) => sum + Math.abs(Number(m.delta) || 0), 0);
    return { ...p, sold: outbound };
  });

  const soldItems = productSales.filter(p => p.sold > 0).sort((a, b) => b.sold - a.sold);

  if (!soldItems.length) {
    container.innerHTML = `<div class="col-span-2 p-6 text-center text-xs text-gray-400 font-medium bg-gray-50 rounded">Belum ada aktivitas penjualan tercatat.</div>`;
    return;
  }

  const topItems = soldItems.slice(0, 2);
  const sampleIcons = [
    '<svg class="w-8 h-8 text-amber-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z"/></svg>',
    '<svg class="w-8 h-8 text-sky-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m2 4 3 12h14l3-12-6 7-4-7-4 7-6-7zm3 16h14"/></svg>'
  ];

  container.innerHTML = topItems.map((p, idx) => `
    <div class="border border-gray-100 rounded p-3 flex flex-col items-center text-center bg-gray-50/50 hover:bg-gray-50 transition">
      <div class="w-14 h-14 rounded bg-white border border-gray-200 flex items-center justify-center mb-2">
        ${sampleIcons[idx % sampleIcons.length]}
      </div>
      <strong class="text-xs font-semibold text-gray-900 truncate w-full" title="${esc(p.name)}">${esc(p.name)}</strong>
      <div class="mt-2 text-center">
        <span class="text-base font-bold text-gray-900 tabular-nums">${p.sold.toLocaleString('id-ID')}</span>
        <span class="text-[11px] text-gray-500 font-medium">terjual (${esc(p.unit || 'pcs')})</span>
      </div>
    </div>
  `).join('');
}

function renderSalesOrdersTable(products) {
  const tbody = $('#salesOrderRows');
  if (!tbody) return;

  const salesOrders = dashboard.salesOrders || [];
  if (!salesOrders.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-state text-center py-6 text-xs text-gray-400">Belum ada data pesanan penjualan atau kanal distribusi.</td></tr>`;
    return;
  }

  tbody.innerHTML = salesOrders.map(c => `
    <tr>
      <td class="font-medium text-gray-900 text-xs">${esc(c.name)}</td>
      <td class="text-right text-gray-600 tabular-nums">${Number(c.draft || 0).toLocaleString('id-ID')}</td>
      <td class="text-right text-sky-700 font-semibold tabular-nums">${Number(c.confirmed || 0).toLocaleString('id-ID')}</td>
      <td class="text-right text-amber-700 font-semibold tabular-nums">${Number(c.packed || 0).toLocaleString('id-ID')}</td>
      <td class="text-right text-emerald-700 font-semibold tabular-nums">${Number(c.shipped || 0).toLocaleString('id-ID')}</td>
    </tr>
  `).join('');
}

// Sub-widget 1: Expiring Soon (<30 or <60 days)
function renderExpiringSoon(products) {
  const container = $('#expiringProductList');
  const badgeCount = $('#expiringCountBadge');
  if (!container) return;

  const now = Date.now();
  const expiringItems = products
    .filter(p => p.expiryDate && p.stock > 0)
    .map(p => {
      const days = Math.ceil((new Date(p.expiryDate).getTime() - now) / 86400000);
      return { ...p, daysRemaining: days };
    })
    .filter(p => activeExpFilter === 'urgent' ? p.daysRemaining <= 30 : p.daysRemaining <= 60)
    .sort((a, b) => a.daysRemaining - b.daysRemaining);

  if (badgeCount) badgeCount.textContent = `${expiringItems.length} Produk`;

  if (!expiringItems.length) {
    container.innerHTML = `<div class="p-6 text-center text-xs text-gray-400 font-medium bg-gray-50 rounded-lg">Tidak ada produk yang mendekati kedaluwarsa (${activeExpFilter === 'urgent' ? '< 30 hari' : '< 60 hari'}).</div>`;
    return;
  }

  container.innerHTML = expiringItems.map(p => {
    const isUrgent = p.daysRemaining <= 30;
    const badgeClass = isUrgent 
      ? 'bg-rose-50 text-rose-700 border border-rose-200' 
      : 'bg-amber-50 text-amber-700 border border-amber-200';
    const dayLabel = p.daysRemaining <= 0 ? 'Kedaluwarsa Hari Ini' : `${p.daysRemaining} hari lagi`;

    return `
      <div class="flex items-center justify-between p-2.5 bg-gray-50 border border-gray-100 rounded-lg hover:bg-gray-100/70 transition">
        <div class="flex items-center gap-2.5 min-w-0">
          <span class="w-8 h-8 rounded-lg bg-white border border-gray-200 flex items-center justify-center text-base shrink-0">
            ${icons[dashboard.products.indexOf(p) % icons.length] || '📦'}
          </span>
          <div class="truncate">
            <strong class="block text-xs font-semibold text-gray-900 truncate">${esc(p.name)}</strong>
            <span class="text-[10px] text-gray-500">${esc(p.sku)} · ${esc(p.location)} · Sisa ${p.stock} ${esc(p.unit)}</span>
          </div>
        </div>
        <div class="text-right shrink-0 ml-2">
          <span class="inline-block px-2 py-0.5 text-[10px] font-bold rounded-full ${badgeClass}">${dayLabel}</span>
          <div class="text-[10px] text-gray-400 mt-0.5">Exp: ${dateShort(p.expiryDate)}</div>
        </div>
      </div>
    `;
  }).join('');
}

// Sub-widget 2: Pending Approvals
function renderPendingApprovals(approvals = []) {
  const container = $('#pendingApprovalsList');
  const badgeCount = $('#pendingApprovalsBadge');
  if (!container) return;

  const pending = approvals.filter(a => a.status === 'pending');
  if (badgeCount) badgeCount.textContent = `${pending.length} Menunggu`;

  if (!pending.length) {
    container.innerHTML = `<div class="p-6 text-center text-xs text-gray-400 font-medium bg-gray-50 rounded-lg">Tidak ada persetujuan yang tertunda saat ini.</div>`;
    return;
  }

  container.innerHTML = pending.map(a => `
    <div class="p-2.5 bg-gray-50 border border-gray-100 rounded-lg flex flex-col gap-2">
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <div class="flex items-center gap-1.5 mb-0.5">
            <span class="px-1.5 py-0.5 text-[11px] font-bold uppercase rounded ${a.type==='transfer'?'bg-blue-50 text-blue-700 border border-blue-200':'bg-purple-50 text-purple-700 border border-purple-200'}">
              ${a.type === 'transfer' ? 'Transfer' : 'Purchase'}
            </span>
            <strong class="text-xs font-semibold text-gray-900 truncate">${esc(a.title)}</strong>
          </div>
          <div class="text-[11px] text-gray-500">
            Pemohon: <span class="font-medium text-gray-700">${esc(a.requester)}</span> · ${esc(a.quantity)} unit (${esc(a.from)} → ${esc(a.to)})
          </div>
        </div>
        <div class="flex items-center gap-1 shrink-0">
          <button type="button" class="px-2 py-1 text-xs font-semibold rounded bg-emerald-600 text-white hover:bg-emerald-700 transition" data-approval-action="approve" data-id="${esc(a.id)}">✓ Setujui</button>
          <button type="button" class="px-2 py-1 text-xs font-semibold rounded bg-gray-200 text-gray-700 hover:bg-rose-50 hover:text-rose-700 transition" data-approval-action="reject" data-id="${esc(a.id)}">✕ Tolak</button>
        </div>
      </div>
    </div>
  `).join('');
}

// Sub-widget 3: Top / Worst Movers
function renderMovers(products) {
  const container = $('#moversList');
  if (!container) return;

  // Score products based on sales/turnover frequency in movements & session variances
  const scored = products.map(p => {
    const moves = dashboard.movements.filter(m => m.productId === p.id);
    const turnover = moves.reduce((sum, m) => sum + Math.abs(m.delta || 0), 0) + (p.lastCounted ? 10 : 0);
    return { ...p, turnoverScore: turnover };
  });

  const list = activeMoversTab === 'top'
    ? scored.sort((a, b) => b.turnoverScore - a.turnoverScore).slice(0, 5)
    : scored.sort((a, b) => a.turnoverScore - b.turnoverScore).slice(0, 5);

  container.innerHTML = list.map((p, idx) => `
    <div class="flex items-center justify-between p-2 bg-gray-50 border border-gray-100 rounded-lg">
      <div class="flex items-center gap-2 min-w-0">
        <span class="w-5 h-5 rounded-full ${activeMoversTab==='top'?'bg-amber-100 text-amber-800':'bg-blue-100 text-blue-800'} text-[10px] font-bold flex items-center justify-center shrink-0">
          ${idx + 1}
        </span>
        <div class="truncate">
          <span class="block text-xs font-semibold text-gray-900 truncate">${esc(p.name)}</span>
          <span class="text-[10px] text-gray-500">${esc(p.category)} · Stok: ${p.stock} ${esc(p.unit)}</span>
        </div>
      </div>
      <span class="text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${activeMoversTab==='top'?'bg-emerald-50 text-emerald-700':'bg-gray-100 text-gray-600'}">
        ${activeMoversTab === 'top' ? '🔥 Cepat' : '❄️ Mengendap'}
      </span>
    </div>
  `).join('') || `<div class="p-4 text-center text-xs text-gray-400">Belum ada data mutasi.</div>`;
}

// Sub-widget 4: Storage Capacity
function renderStorageCapacity(products) {
  const container = $('#storageCapacityContent');
  if (!container) return;

  const totalUnits = products.reduce((sum, p) => sum + p.stock, 0);
  const maxCapacity = 200;
  const overallPct = Math.min(100, Math.round((totalUnits / maxCapacity) * 100));

  // Racks breakdown
  const racks = [
    { name: 'Rak A (Minuman & Cairan)', prefix: 'Rak A', max: 80, color: 'bg-brand-500' },
    { name: 'Rak B (Sembako & Pangan)', prefix: 'Rak B', max: 50, color: 'bg-emerald-500' },
    { name: 'Rak C (Makanan Ringan)', prefix: 'Rak C', max: 40, color: 'bg-amber-500' },
    { name: 'Rak D (Kesehatan & Suplemen)', prefix: 'Rak D', max: 30, color: 'bg-sky-500' }
  ];

  const rackBars = racks.map(r => {
    const current = products
      .filter(p => (p.location || '').startsWith(r.prefix))
      .reduce((s, p) => s + p.stock, 0);
    const pct = Math.min(100, Math.round((current / r.max) * 100));
    return `
      <div>
        <div class="flex justify-between text-xs text-gray-600 mb-1">
          <span class="font-medium text-[11px]">${esc(r.name)}</span>
          <span class="font-bold text-gray-900 text-[11px]">${current}/${r.max} (${pct}%)</span>
        </div>
        <div class="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
          <div class="h-full ${r.color} rounded-full transition-all duration-300" style="width: ${pct}%"></div>
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = `
    <div class="p-3 bg-gray-50 border border-gray-100 rounded-lg">
      <div class="flex justify-between items-center mb-1.5">
        <span class="text-xs font-semibold text-gray-700">Utilisasi Gudang Utama</span>
        <span class="text-xs font-bold text-gray-900">${overallPct}% Penuh (${totalUnits}/${maxCapacity} unit)</span>
      </div>
      <div class="w-full h-3 bg-gray-200 rounded-full overflow-hidden">
        <div class="h-full bg-brand-500 rounded-full transition-all duration-300" style="width: ${overallPct}%"></div>
      </div>
    </div>
    <div class="space-y-2.5">
      ${rackBars}
    </div>
  `;
}

// Sub-widget 5: Valuation Donut Chart (Flat Modern SVG)
function renderValuationDonut(products, totalValue) {
  const container = $('#valuationDonutContainer');
  if (!container) return;

  const categories = {};
  products.forEach(p => {
    categories[p.category] = (categories[p.category] || 0) + (p.stock * p.cost);
  });

  const catEntries = Object.entries(categories).filter(([, val]) => val > 0);
  if (!catEntries.length || totalValue === 0) {
    container.innerHTML = `<div class="p-6 text-center text-xs text-gray-400">Belum ada valuasi produk.</div>`;
    return;
  }

  const palette = ['#6254d9', '#10b981', '#f59e0b', '#0284c7', '#ec4899', '#8b5cf6'];
  const radius = 48;
  const circumference = 2 * Math.PI * radius; // ~301.59
  let accumulatedOffset = 0;

  const arcs = catEntries.map(([cat, val], idx) => {
    const fraction = val / totalValue;
    const strokeDash = fraction * circumference;
    const strokeOffset = -accumulatedOffset;
    accumulatedOffset += strokeDash;
    const color = palette[idx % palette.length];

    return `<circle cx="64" cy="64" r="${radius}" fill="none" stroke="${color}" stroke-width="15" stroke-dasharray="${strokeDash} ${circumference}" stroke-dashoffset="${strokeOffset}" stroke-linecap="round" class="transition-all duration-300" />`;
  }).join('');

  const legends = catEntries.map(([cat, val], idx) => {
    const pct = Math.round((val / totalValue) * 100);
    const color = palette[idx % palette.length];
    return `
      <div class="flex items-center justify-between text-xs py-0.5">
        <div class="flex items-center gap-1.5 truncate">
          <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background-color: ${color}"></span>
          <span class="text-gray-600 font-medium truncate text-[11px]">${esc(cat)}</span>
        </div>
        <div class="text-right shrink-0 pl-2">
          <span class="font-bold text-gray-900 text-[11px]">${pct}%</span>
          <span class="text-[10px] text-gray-400">(${money(val)})</span>
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = `
    <div class="flex flex-col sm:flex-row items-center gap-4 w-full">
      <div class="relative w-32 h-32 shrink-0 flex items-center justify-center">
        <svg class="w-32 h-32 -rotate-90 transform" viewBox="0 0 128 128">
          <circle cx="64" cy="64" r="${radius}" fill="none" stroke="#f1f2f6" stroke-width="15" />
          ${arcs}
        </svg>
        <div class="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
          <span class="text-[9px] uppercase tracking-wider text-gray-400 font-bold">Total Nilai</span>
          <strong class="text-xs font-bold text-gray-900">${money(totalValue).split(',')[0]}</strong>
        </div>
      </div>
      <div class="flex-1 w-full space-y-1">
        ${legends}
      </div>
    </div>
  `;
}

// Sub-widget 6: Inventory Table
function renderInventoryTable(products) {
  const table = $('#inventoryRows');
  if (!table) return;
  table.innerHTML = products.slice().sort((a,b)=>a.stock-b.stock).slice(0, 5).map(p => `
    <tr>
      <td>${productName(p)}</td>
      <td>${esc(p.category)}</td>
      <td class="sku">${esc(p.sku)}</td>
      <td>${formatStock(p)}</td>
      <td>${badge(p)}</td>
    </tr>
  `).join('') || '<tr><td colspan="5" class="empty-state">Belum ada produk untuk lokasi ini.</td></tr>';
}

// Sub-widget 7: Sessions List
function renderSessionList(sessions) {
  const sessionList = $('#sessionList');
  if (!sessionList) return;
  sessionList.innerHTML = sessions.filter(s => s.status === 'Berlangsung').slice(0, 3).map(s => {
    const pct = Math.round(s.itemsChecked / Math.max(s.totalItems, 1) * 100);
    return `
      <div class="session-row">
        <div><div class="session-title">${esc(s.name)}</div></div>
        <div class="session-location">${esc(s.location)}</div>
        <div class="session-date">${dateShort(s.date)}</div>
        <div class="progress-cell">
          <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
          <span class="progress-label">${pct}%</span>
        </div>
        <div class="session-status-cell">
          <button class="button secondary" data-count="${esc(s.id)}">Lanjutkan</button>
        </div>
      </div>
    `;
  }).join('') || '<div class="empty-state">Tidak ada stock opname yang sedang berjalan.</div>';
}

// Sub-widget 8: Pemantauan Real-time & Activity Audit Trail
function renderActivityAuditTrail() {
  const container = $('#activityAuditList');
  if (!container) return;

  const { activities = [] } = dashboard;
  
  // Filter activities by date range and location if set
  const filteredActivities = activities.filter(a => {
    const matchDate = isDateInRange(a.time);
    const matchLoc = !activeLocation || (a.text || '').toLowerCase().includes(activeLocation.toLowerCase());
    return matchDate && matchLoc;
  });

  // STRICT EMPTY STATE RULE:
  // "Jika akun baru dibuat atau tidak ada data, JANGAN tampilkan data dummy atau aktivitas dari akun pengguna lain.
  // Tampilkan antarmuka kosong yang rapi di tengah dengan pesan: 'Belum ada aktivitas'."
  if (!filteredActivities.length) {
    container.innerHTML = `
      <div class="flex flex-col items-center justify-center p-8 text-center my-auto">
        <div class="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center text-gray-400 mb-2">
          <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        </div>
        <span class="text-xs font-semibold text-gray-500">Belum ada aktivitas</span>
        <p class="text-[11px] text-gray-400 mt-0.5">Catatan mutasi dan opname akan muncul di sini secara real-time.</p>
      </div>
    `;
    return;
  }

  const iconsMap = {
    complete: { icon: '<svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>', color: 'bg-emerald-500 text-white' },
    edit: { icon: '<svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>', color: 'bg-brand-500 text-white' },
    start: { icon: '<svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>', color: 'bg-blue-500 text-white' },
    add: { icon: '<svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>', color: 'bg-amber-500 text-white' }
  };

  container.innerHTML = filteredActivities.slice(0, 15).map(a => {
    const meta = iconsMap[a.type] || { icon: '•', color: 'bg-gray-400 text-white' };
    return `
      <div class="relative flex items-start gap-3 text-left">
        <span class="w-5 h-5 rounded-full ${meta.color} flex items-center justify-center text-[10px] font-bold shrink-0 z-10 shadow-xs -ml-2.5 mt-0.5">
          ${meta.icon}
        </span>
        <div class="flex-1 min-w-0">
          <p class="text-xs font-medium text-gray-900 leading-snug break-words">${esc(a.text)}</p>
          <div class="text-[10px] text-gray-400 flex items-center gap-1.5 mt-0.5">
            <span class="font-semibold text-gray-600">${esc(a.user)}</span>
            <span>·</span>
            <span>${timeAgo(a.time)}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function populateLocationFilter() {
  const select = $('#overviewLocationFilter');
  if (!select) return;
  const current = select.value;
  const locations = dashboard.locations || [...new Set([...dashboard.products.map(p=>p.location), ...dashboard.sessions.map(s=>s.location)].filter(Boolean))].sort();
  select.innerHTML = '<option value="">Semua Lokasi</option>' + locations.map(l => `<option value="${esc(l)}" ${current===l?'selected':''}>${esc(l)}</option>`).join('');
  select.value = locations.includes(current) ? current : '';
}

function renderProducts() {
  const q = ($('#productSearch')?.value || '').toLowerCase();
  const cat = $('#categoryFilter')?.value || '';
  const state = $('#stockFilter')?.value || '';
  const filtered = dashboard.products.filter(p => {
    const [label] = stockStatus(p);
    return `${p.name} ${p.sku} ${p.location}`.toLowerCase().includes(q) && (!cat || p.category === cat) && (!state || label === state);
  });
  $('#productsRows').innerHTML = filtered.map(p => `
    <tr>
      <td>${productName(p)}</td>
      <td><span class="text-gray-700 font-medium">${esc(p.category)}</span></td>
      <td><span class="sku">${esc(p.sku)}</span></td>
      <td><span class="text-gray-600">${esc(p.location)}</span></td>
      <td class="text-right">${formatStock(p)}</td>
      <td class="text-right text-gray-500">${Number(p.minStock ?? 10)} ${esc(p.unit)}</td>
      <td class="text-right font-semibold text-gray-900">${money(p.stock * p.cost)}</td>
      <td class="text-center">${badge(p)}</td>
      <td class="text-right">
        <div class="row-actions">
          <button class="table-action" data-adjust="${esc(p.id)}" title="Sesuaikan Stok (Masuk/Keluar)">
            <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 5v14M5 12h14"/></svg>
          </button>
          <button class="table-action" data-edit="${esc(p.id)}" title="Edit Data Produk">
            <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="table-action danger-action" data-delete="${esc(p.id)}" title="Hapus Produk">
            <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="9" class="empty-state">Produk tidak ditemukan.</td></tr>';
}

function renderSessions() {
  const filter = $('#sessionFilter')?.value || '';
  const sessions = dashboard.sessions.filter(s => !filter || s.status === filter);
  $('#sessionsRows').innerHTML = sessions.map(s => {
    const pct = Math.round(s.itemsChecked / Math.max(s.totalItems, 1) * 100);
    return `
      <tr>
        <td>
          <div class="session-name-cell">
            <span class="session-mini-icon">
              <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M16 3v4M8 3v4M3 10h18"/></svg>
            </span>
            <strong>${esc(s.name)}</strong>
          </div>
        </td>
        <td><span class="text-gray-600">${esc(s.location)}</span></td>
        <td><span class="text-gray-600 font-medium">${dateShort(s.date)}</span></td>
        <td>
          <div class="progress-table">
            <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
            <span class="text-xs font-semibold text-gray-700">${s.itemsChecked}/${s.totalItems}</span>
          </div>
        </td>
        <td class="text-right">${s.discrepancies ? `<span class="stock-low font-bold">${s.discrepancies} item</span>` : '<span class="text-gray-400">0</span>'}</td>
        <td class="text-center"><span class="badge ${s.status === 'Selesai' ? 'done' : 'progress'}">${esc(s.status)}</span></td>
        <td class="text-right">${s.status === 'Berlangsung' ? `<button class="button secondary text-xs py-1 px-3" data-count="${esc(s.id)}">Lanjutkan Hitung</button>` : '<span class="text-xs text-gray-400">Selesai</span>'}</td>
      </tr>
    `;
  }).join('') || '<tr><td colspan="7" class="empty-state">Belum ada sesi stock opname.</td></tr>';
}

function renderReports() {
  const { products, stats, movements = [] } = dashboard;
  $('#reportValue').textContent = money(stats.value);
  $('#reportLow').textContent = stats.lowStock;
  $('#reportProducts').textContent = stats.products;
  $('#reportUnits').textContent = Number(stats.availableUnits || 0).toLocaleString('id-ID');

  const categories = {};
  products.forEach(p => categories[p.category] = (categories[p.category] || 0) + Number(p.stock));
  const max = Math.max(...Object.values(categories), 1);
  $('#categoryChart').innerHTML = Object.entries(categories).map(([name, count]) => `
    <div class="category-row">
      <span>${esc(name)}</span>
      <div class="category-track"><div class="category-fill" style="width:${(count / max) * 100}%"></div></div>
      <strong>${count}</strong>
    </div>
  `).join('') || '<div class="empty-state">Belum ada data produk.</div>';

  const low = products.filter(p => p.stock <= Number(p.minStock ?? 10));
  $('#restockRows').innerHTML = low.map(p => {
    const suggested = Math.max(Number(p.minStock ?? 10) * 2 - p.stock, 0);
    return `
      <tr>
        <td>${productName(p)}</td>
        <td><span class="text-gray-700">${esc(p.category)}</span></td>
        <td><span class="text-gray-600">${esc(p.location)}</span></td>
        <td class="text-right">${formatStock(p)} <small class="text-gray-400">(min ${p.minStock ?? 10})</small></td>
        <td class="text-right font-semibold text-amber-700">${suggested} ${esc(p.unit)}</td>
        <td class="text-right"><button class="button secondary text-xs py-1 px-3" data-restock="${esc(p.id)}" data-quantity="${suggested}">＋ Restock</button></td>
      </tr>
    `;
  }).join('') || '<tr><td colspan="6" class="empty-state">Semua produk berada di atas stok minimum.</td></tr>';

  $('#movementRows').innerHTML = movements.slice(0, 12).map(m => `
    <tr>
      <td><span class="text-gray-600 font-medium">${dateShort(m.createdAt)}</span></td>
      <td><div class="product-name">${esc(m.productName)} <span class="sku">${esc(m.sku)}</span></div></td>
      <td class="text-right"><span class="${m.delta > 0 ? 'text-emerald-700 font-bold' : 'text-rose-700 font-bold'}">${m.delta > 0 ? '+' : ''}${m.delta}</span></td>
      <td><span class="text-gray-700">${esc(m.reason)}</span></td>
      <td><span class="text-gray-600">${esc(m.user)}</span></td>
    </tr>
  `).join('') || '<tr><td colspan="5" class="empty-state">Belum ada riwayat mutasi stok.</td></tr>';
}

function render() {
  renderOverview();
  renderProducts();
  renderSessions();
  renderReports();
  $('#settingsCount').textContent = `${dashboard.products.length} produk`;
  populateCategories();
}

function populateCategories() {
  const select = $('#categoryFilter');
  if (!select) return;
  const current = select.value;
  const cats = [...new Set(dashboard.products.map(p => p.category))].sort();
  select.innerHTML = '<option value="">Semua kategori</option>' + cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  select.value = cats.includes(current) ? current : '';
}

async function refresh() {
  dashboard = await api('/api/dashboard');
  render();
}

const pages = { overview: 'Ringkasan', products: 'Data Produk', sessions: 'Stock Opname', reports: 'Laporan', feedback: 'Kritik & Saran', admin: 'Admin & Monitoring', settings: 'Pengaturan' };

function toggleSidebar(forceState) {
  const sidebar = $('#sidebar');
  const backdrop = $('#sidebarBackdrop');
  if (!sidebar) return;
  const isOpen = forceState !== undefined ? forceState : !sidebar.classList.contains('open');
  sidebar.classList.toggle('open', isOpen);
  backdrop?.classList.toggle('active', isOpen);
}

function go(page) {
  if (!pages[page] || (page === 'admin' && currentUser?.role?.toLowerCase() !== 'admin')) return;
  $$('.page').forEach(p => p.classList.toggle('active-page', p.id === `page-${page}`));
  $$('.nav-link[data-page]').forEach(a => a.classList.toggle('active', a.dataset.page === page));
  $$('.bottom-nav-item[data-page]').forEach(a => a.classList.toggle('active', a.dataset.page === page));
  if ($('#breadcrumb')) $('#breadcrumb').textContent = pages[page];
  toggleSidebar(false);
  history.replaceState(null, '', `#${page}`);
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (page === 'admin') loadAdmin();
  if (page === 'feedback') loadMyFeedback();
  if (page === 'settings') refreshPushState();
}

function closeModal() {
  if (window.__activeCameraStream) {
    try {
      window.__activeCameraStream.getTracks().forEach(t => t.stop());
    } catch (_) {}
    window.__activeCameraStream = null;
  }
  if (window.__activeBarcodeTimer) {
    clearInterval(window.__activeBarcodeTimer);
    window.__activeBarcodeTimer = null;
  }
  $('#modalBackdrop').classList.remove('open');
}

function modalFrame(title, subtitle, body, submitText = 'Simpan', secondaryText = 'Batal') {
  $('#modal').innerHTML = `
    <div class="modal-head">
      <div><h2>${title}</h2><p>${subtitle}</p></div>
      <button class="close-modal" data-close aria-label="Tutup">×</button>
    </div>
    <div class="modal-body">${body}</div>
    <div class="modal-foot">
      <button class="button secondary" data-close>${secondaryText}</button>
      <button class="button primary" id="modalSubmit">${submitText}</button>
    </div>
  `;
  $('#modalBackdrop').classList.add('open');
  $$('[data-close]', $('#modal')).forEach(b => b.addEventListener('click', closeModal));
}

// Quick Action: Barcode Scanner Modal
function openBarcodeScannerModal() {
  modalFrame(
    'Scan Barcode Produk',
    'Arahkan kamera atau masukkan barcode/SKU produk untuk pencarian instan.',
    `
      <div class="flex flex-col gap-3">
        <div class="relative bg-gray-900 rounded-xl p-4 text-center text-white flex flex-col items-center justify-center min-h-[190px] overflow-hidden">
          <video id="barcodeVideo" class="absolute inset-0 w-full h-full object-cover hidden" playsinline autoplay muted></video>
          <div id="viewfinderScanline" class="absolute inset-x-8 top-1/2 -translate-y-1/2 h-0.5 bg-rose-500 animate-pulse shadow-md shadow-rose-500 z-10 pointer-events-none"></div>
          <div id="viewfinderPlaceholder" class="relative z-10 flex flex-col items-center justify-center">
            <svg class="w-12 h-12 text-gray-500 mb-2 opacity-60" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><line x1="7" y1="12" x2="17" y2="12"/></svg>
            <span class="text-xs font-semibold text-gray-300">Viewfinder Pemindai Siap</span>
            <span class="text-[10px] text-gray-400">Pindai barcode langsung via kamera atau ketik SKU</span>
          </div>
          <button type="button" id="btnToggleCamera" class="relative z-20 mt-3 inline-flex items-center gap-1.5 px-3 py-1 bg-white/20 hover:bg-white/30 backdrop-blur-sm text-white text-[11px] font-semibold rounded-lg transition">
            📷 Aktifkan Kamera
          </button>
        </div>
        <div class="flex gap-2">
          <input type="text" id="barcodeScanInput" placeholder="Ketik SKU (misal: KOP-AR-250)..." class="flex-1 h-10 px-3 border border-gray-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-brand-500 uppercase">
          <button type="button" id="btnLookupSku" class="button primary px-4 text-xs font-semibold">Cari SKU</button>
        </div>
        <div id="barcodeScanResult" class="p-3 bg-gray-50 border border-gray-100 rounded-lg hidden">
          <!-- Live found item info -->
        </div>
        <div class="text-[10px] text-gray-500">
          💡 SKU Cepat: ${dashboard.products.slice(0, 4).map(p=>`<button type="button" class="text-brand-600 underline font-semibold mr-1.5" data-quick-sku="${esc(p.sku)}">${esc(p.sku)}</button>`).join('')}
        </div>
      </div>
    `,
    'Tutup Pemindai'
  );

  const input = $('#barcodeScanInput');
  const resultBox = $('#barcodeScanResult');
  const btnToggleCam = $('#btnToggleCamera');
  const video = $('#barcodeVideo');
  const placeholder = $('#viewfinderPlaceholder');

  btnToggleCam?.addEventListener('click', async () => {
    if (window.__activeCameraStream) {
      window.__activeCameraStream.getTracks().forEach(t => t.stop());
      window.__activeCameraStream = null;
      if (window.__activeBarcodeTimer) {
        clearInterval(window.__activeBarcodeTimer);
        window.__activeBarcodeTimer = null;
      }
      video.classList.add('hidden');
      placeholder.classList.remove('hidden');
      btnToggleCam.innerHTML = '📷 Aktifkan Kamera';
      return;
    }

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        toast('Kamera tidak didukung oleh browser Anda.');
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      });
      window.__activeCameraStream = stream;
      video.srcObject = stream;
      video.classList.remove('hidden');
      placeholder.classList.add('hidden');
      btnToggleCam.innerHTML = '⏹ Matikan Kamera';

      if ('BarcodeDetector' in window) {
        const barcodeDetector = new window.BarcodeDetector({
          formats: ['code_128', 'ean_13', 'ean_8', 'qr_code', 'upc_a', 'upc_e']
        });
        window.__activeBarcodeTimer = setInterval(async () => {
          try {
            const barcodes = await barcodeDetector.detect(video);
            if (barcodes && barcodes.length > 0) {
              const code = barcodes[0].rawValue;
              if (input) input.value = code;
              lookup();
            }
          } catch (_) {}
        }, 500);
      }
    } catch (err) {
      toast('Gagal mengakses kamera: ' + (err.message || 'Izin kamera ditolak'));
    }
  });

  const lookup = () => {
    const query = (input?.value || '').trim().toLowerCase();
    if (!query) return;
    const match = dashboard.products.find(p => p.sku.toLowerCase() === query || p.name.toLowerCase().includes(query));
    if (match) {
      resultBox.classList.remove('hidden');
      resultBox.innerHTML = `
        <div class="flex items-center justify-between">
          <div>
            <strong class="block text-xs font-bold text-gray-900">${esc(match.name)}</strong>
            <span class="text-[10px] text-gray-500">${esc(match.sku)} · ${esc(match.location)} · Stok: <b class="text-gray-900">${match.stock} ${esc(match.unit)}</b></span>
          </div>
          <button type="button" class="px-2.5 py-1 text-xs font-semibold bg-brand-500 text-white rounded-lg shadow-sm" data-adjust="${esc(match.id)}">± Atur Stok</button>
        </div>
      `;
    } else {
      resultBox.classList.remove('hidden');
      resultBox.innerHTML = `<span class="text-xs text-rose-600 font-medium">Produk dengan SKU/nama "${esc(query)}" tidak ditemukan.</span>`;
    }
  };

  $('#btnLookupSku')?.addEventListener('click', lookup);
  input?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); lookup(); } });
  
  $$('[data-quick-sku]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (input) input.value = btn.dataset.quickSku;
      lookup();
    });
  });

  $('#modalSubmit')?.addEventListener('click', closeModal);
}

function openProductForm(product = null) {
  const p = product || { name: '', category: '', sku: '', location: '', stock: 0, minStock: 10, unit: 'pcs', cost: 0, expiryDate: '' };
  const categorySuggestions = [...new Set(['Minuman', 'Makanan', 'Sembako', 'Kesehatan', 'Gelas', 'Peralatan', 'Alat Kebersihan', 'Kemasan', 'Elektronik', 'Lainnya', ...dashboard.products.map(item => item.category), p.category].filter(Boolean))];

  modalFrame(
    product ? 'Edit Produk' : 'Tambah Produk',
    product ? 'Perbarui informasi dan batas minimum stok.' : 'Tambahkan produk ke inventaris Anda.',
    `
      <form id="productForm" class="form-grid">
        <div class="form-field full"><label>Nama produk *</label><input name="name" value="${esc(p.name)}" required placeholder="Contoh: Kopi Arabika Gayo 250g"></div>
        <div class="form-field"><label>SKU *</label><input name="sku" value="${esc(p.sku)}" required placeholder="KOP-AR-250"></div>
        <div class="form-field"><label>Kategori</label><input name="category" list="categorySuggestions" value="${esc(p.category)}" placeholder="Pilih atau ketik kategori"><datalist id="categorySuggestions">${categorySuggestions.map(category => `<option value="${esc(category)}">`).join('')}</datalist></div>
        <div class="form-field"><label>Lokasi penyimpanan</label><input name="location" value="${esc(p.location)}" placeholder="Rak A-01"></div>
        <div class="form-field"><label>Satuan</label><select name="unit">${['pcs', 'botol', 'karton', 'karung', 'pack', 'kg', 'liter'].map(u => `<option ${p.unit === u ? 'selected' : ''}>${u}</option>`).join('')}</select></div>
        <div class="form-field"><label>Stok tersedia</label><input name="stock" type="number" min="0" step="1" value="${Number(p.stock)}"></div>
        <div class="form-field"><label>Stok minimum</label><input name="minStock" type="number" min="0" step="1" value="${Number(p.minStock ?? 10)}"></div>
        <div class="form-field"><label>Harga modal (Rp)</label><input name="cost" type="number" min="0" value="${Number(p.cost)}"></div>
        <div class="form-field"><label>Tanggal Kedaluwarsa</label><input name="expiryDate" type="date" value="${p.expiryDate ? p.expiryDate.slice(0,10) : ''}"></div>
      </form>
    `
  );

  const form = $('#productForm');
  form?.addEventListener('submit', e => { e.preventDefault(); $('#modalSubmit')?.click(); });

  $('#modalSubmit').addEventListener('click', async () => {
    const f = $('#productForm');
    if (!f || !f.reportValidity()) return;
    const btn = $('#modalSubmit');
    if (btn) btn.disabled = true;
    const d = Object.fromEntries(new FormData(f));
    for (const key of ['stock', 'minStock', 'cost']) d[key] = Number(d[key]) || 0;
    try {
      await api(product ? `/api/products/${encodeURIComponent(product.id)}` : '/api/products', {
        method: product ? 'PUT' : 'POST',
        body: JSON.stringify(d)
      });
      closeModal();
      await refresh();
      toast(product ? 'Produk berhasil diperbarui.' : 'Produk berhasil ditambahkan.');
    } catch (e) {
      toast(e.message);
      if (btn) btn.disabled = false;
    }
  });
}

function openAdjustForm(product, quantity = null) {
  const suggested = Math.max(Number(product.minStock ?? 10) * 2 - product.stock, 1);
  const initial = quantity || suggested;
  modalFrame(
    `Mutasi Stok`,
    `${product.name} · stok saat ini ${product.stock} ${product.unit}`,
    `
      <form id="adjustForm" class="form-grid" onsubmit="return false;">
        <div class="form-field"><label>Jenis mutasi</label><select name="direction"><option value="in">Stok masuk</option><option value="out">Stok keluar</option></select></div>
        <div class="form-field"><label>Jumlah (${esc(product.unit)})</label><input name="quantity" type="number" min="1" step="1" value="${initial}" required></div>
        <div class="form-field full"><label>Catatan</label><input name="reason" value="Penerimaan / restock" placeholder="Contoh: Pembelian PO-001"></div>
        <div class="form-field full"><span class="form-help">Stok minimum: ${product.minStock ?? 10} ${esc(product.unit)} · perubahan akan otomatis tercatat di Activity Audit Trail.</span></div>
      </form>
    `,
    'Simpan Mutasi'
  );
  const adjForm = $('#adjustForm');
  adjForm?.addEventListener('submit', e => { e.preventDefault(); $('#modalSubmit')?.click(); });

  $('#modalSubmit').addEventListener('click', async () => {
    const f = $('#adjustForm');
    if (!f || !f.reportValidity()) return;
    const btn = $('#modalSubmit');
    if (btn) btn.disabled = true;
    const d = Object.fromEntries(new FormData(f));
    const delta = (d.direction === 'out' ? -1 : 1) * Number(d.quantity);
    try {
      await api(`/api/products/${encodeURIComponent(product.id)}/adjust`, {
        method: 'POST',
        body: JSON.stringify({ delta, reason: d.reason })
      });
      closeModal();
      await refresh();
      toast('Mutasi stok berhasil disimpan.');
    } catch (e) {
      toast(e.message);
      if (btn) btn.disabled = false;
    }
  });
}

function openDeleteConfirm(product) {
  modalFrame(
    'Hapus produk?',
    `Produk ${product.name} akan dihapus dari daftar inventaris.`,
    `<p>Stok saat ini: <strong>${product.stock} ${esc(product.unit)}</strong></p><p class="form-help">Riwayat opname yang sudah selesai tetap tersimpan, tetapi produk ini tidak lagi muncul di inventaris.</p>`,
    'Hapus Produk'
  );
  $('#modalSubmit').classList.add('danger-button');
  $('#modalSubmit').addEventListener('click', async () => {
    try {
      await api(`/api/products/${encodeURIComponent(product.id)}`, { method: 'DELETE' });
      closeModal();
      await refresh();
      toast('Produk dihapus.');
    } catch (e) {
      toast(e.message);
    }
  });
}

function openResetDataModal() {
  modalFrame(
    'Reset Data Modular & Granular',
    'Pilih data yang ingin Anda kosongkan. Tindakan ini aman dan hanya berdampak pada akun Anda.',
    `
      <div class="flex flex-col gap-3">
        <div class="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 flex items-start gap-2">
          <span class="text-base leading-none">⚠️</span>
          <div>
            <strong>Perhatian:</strong> Data yang direset tidak dapat dipulihkan kembali. Operasi ini terisolasi khusus untuk akun Anda dan tidak mempengaruhi data pengguna lain.
          </div>
        </div>

        <div class="space-y-2">
          <span class="block text-xs font-bold text-gray-700 uppercase tracking-wide">Pilih Cakupan Reset:</span>
          
          <label class="flex items-start gap-3 p-3 bg-white border border-gray-200 rounded-lg hover:border-brand-500 cursor-pointer transition">
            <input type="radio" name="resetScope" value="activities" checked class="mt-1 text-brand-600 focus:ring-brand-500">
            <div>
              <strong class="block text-xs font-semibold text-gray-900">Opsi A: Reset Log Aktivitas Saja</strong>
              <span class="text-[11px] text-gray-500">Mengosongkan riwayat log audit trail/timeline kembali menjadi empty state ("Belum ada aktivitas"). Data produk dan transaksi tetap utuh.</span>
            </div>
          </label>

          <label class="flex items-start gap-3 p-3 bg-white border border-gray-200 rounded-lg hover:border-brand-500 cursor-pointer transition">
            <input type="radio" name="resetScope" value="products" class="mt-1 text-brand-600 focus:ring-brand-500">
            <div>
              <strong class="block text-xs font-semibold text-gray-900">Opsi B: Reset Data Produk/Inventaris Saja</strong>
              <span class="text-[11px] text-gray-500">Menghapus katalog barang Anda (stok kembali ke 0), tanpa menghapus akun atau riwayat aktivitas.</span>
            </div>
          </label>

          <label class="flex items-start gap-3 p-3 bg-white border border-gray-200 rounded-lg hover:border-brand-500 cursor-pointer transition">
            <input type="radio" name="resetScope" value="transactions" class="mt-1 text-brand-600 focus:ring-brand-500">
            <div>
              <strong class="block text-xs font-semibold text-gray-900">Opsi C: Reset Transaksi / Stock Opname Saja</strong>
              <span class="text-[11px] text-gray-500">Mengosongkan catatan mutasi stok, riwayat sesi stock opname, dan persetujuan transfer barang.</span>
            </div>
          </label>

          <label class="flex items-start gap-3 p-3 bg-rose-50/50 border border-rose-200 rounded-lg hover:border-rose-400 cursor-pointer transition">
            <input type="radio" name="resetScope" value="full" class="mt-1 text-rose-600 focus:ring-rose-500">
            <div>
              <strong class="block text-xs font-semibold text-rose-900">Opsi D: Reset Menyeluruh (Full Reset)</strong>
              <span class="text-[11px] text-rose-600">Mengembalikan seluruh metrik, katalog produk, sesi opname, dan riwayat aktivitas akun Anda ke angka 0.</span>
            </div>
          </label>
        </div>

        <div class="pt-2 border-t border-gray-200">
          <label class="block text-xs font-medium text-gray-700 mb-1">
            Ketik kata <strong class="text-rose-600 font-bold tracking-wider">RESET</strong> di bawah untuk mengonfirmasi:
          </label>
          <input type="text" id="resetConfirmInput" placeholder="Ketik RESET" autocomplete="off" class="w-full h-10 px-3 border border-gray-300 rounded-lg text-xs outline-none focus:ring-2 focus:ring-rose-500 uppercase font-mono font-bold">
        </div>
      </div>
    `,
    'Konfirmasi & Eksekusi Reset',
    'Batal'
  );

  const submitBtn = $('#modalSubmit');
  const confirmInput = $('#resetConfirmInput');
  submitBtn.disabled = true;
  submitBtn.className = 'button secondary opacity-50 cursor-not-allowed';

  confirmInput?.addEventListener('input', () => {
    const isMatched = confirmInput.value.trim() === 'RESET';
    submitBtn.disabled = !isMatched;
    if (isMatched) {
      submitBtn.className = 'button danger-button bg-rose-600 text-white font-semibold hover:bg-rose-700 transition';
    } else {
      submitBtn.className = 'button secondary opacity-50 cursor-not-allowed';
    }
  });

  submitBtn?.addEventListener('click', async () => {
    if (confirmInput?.value.trim() !== 'RESET') return;
    const selectedScope = document.querySelector('input[name="resetScope"]:checked')?.value || 'activities';
    try {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Mereset...';
      const result = await api('/api/reset', {
        method: 'POST',
        body: JSON.stringify({ scope: selectedScope, confirmation: 'RESET' })
      });
      closeModal();
      await refresh();
      toast(result.message || 'Data berhasil direset.');
    } catch (err) {
      toast(err.message);
      submitBtn.disabled = false;
      submitBtn.textContent = 'Konfirmasi & Eksekusi Reset';
    }
  });
}

function openSessionForm() {
  modalFrame(
    'Mulai Stock Opname',
    'Buat sesi penghitungan stok fisik baru.',
    `
      <form id="sessionForm" class="form-grid" onsubmit="return false;">
        <div class="form-field full"><label>Nama sesi *</label><input name="name" required value="Stock Opname ${new Intl.DateTimeFormat('id-ID',{day:'numeric',month:'long'}).format(new Date())}"></div>
        <div class="form-field"><label>Lokasi</label><input name="location" value="Gudang Utama"></div>
        <div class="form-field"><label>Penanggung jawab</label><input name="createdBy" value="${esc(currentUser?.name || 'Admin Gudang')}"></div>
        <div class="form-field full"><span class="form-help">Sesi mencakup seluruh ${dashboard.products.length} produk. Progres dapat disimpan dan dilanjutkan nanti.</span></div>
      </form>
    `,
    'Buat Sesi'
  );

  const sessForm = $('#sessionForm');
  sessForm?.addEventListener('submit', e => { e.preventDefault(); $('#modalSubmit')?.click(); });

  $('#modalSubmit').addEventListener('click', async () => {
    const f = $('#sessionForm');
    if (!f || !f.reportValidity()) return;
    const btn = $('#modalSubmit');
    if (btn) btn.disabled = true;
    try {
      const data = await api('/api/sessions', {
        method: 'POST',
        body: JSON.stringify(Object.fromEntries(new FormData(f)))
      });
      closeModal();
      await refresh();
      go('sessions');
      openCountModal(data.id);
      toast('Sesi stock opname dimulai.');
    } catch (e) {
      toast(e.message);
      if (btn) btn.disabled = false;
    }
  });
}

function openCountModal(id) {
  const session = dashboard.sessions.find(s => s.id === id);
  if (!session) return;
  const products = dashboard.products;
  modalFrame(
    'Catat Hasil Opname',
    `${session.name} · ${session.location}`,
    `
      <p class="subsection-label">Hitung jumlah fisik setiap produk</p>
      <div class="count-item-grid">
        ${products.map(p => `
          <div class="count-item">
            <div>
              <strong>${esc(p.name)}</strong>
              <small>Stok sistem: ${p.stock} ${esc(p.unit)} · minimum ${p.minStock ?? 10}</small>
            </div>
            <div>
              <input data-count-product="${esc(p.id)}" type="number" min="0" step="1" placeholder="Jumlah fisik" value="${session.counts?.[p.id] ?? ''}">
            </div>
          </div>
        `).join('')}
      </div>
      <p class="form-help" style="margin:12px 0 0">Terdata ${session.itemsChecked} dari ${session.totalItems} produk. Stok sistem diperbarui setelah sesi diselesaikan.</p>
    `,
    'Simpan Progres'
  );
  const submit = $('#modalSubmit');
  submit.addEventListener('click', async () => { await saveSessionCounts(id, false); });
  const finish = document.createElement('button');
  finish.type = 'button';
  finish.className = 'button primary';
  finish.textContent = 'Selesaikan Sesi';
  finish.id = 'finishSession';
  $('.modal-foot').append(finish);
  finish.addEventListener('click', async () => {
    const inputs = $$('[data-count-product]', $('#modal'));
    const missing = inputs.filter(i => i.value === '').length;
    if (missing && !window.confirm(`Masih ada ${missing} produk belum dihitung. Selesaikan sesi dengan hasil yang sudah dicatat?`)) return;
    await saveSessionCounts(id, true);
  });
}

async function saveSessionCounts(id, complete) {
  const inputs = $$('[data-count-product]', $('#modal')), entries = inputs.filter(i => i.value !== '');
  if (!entries.length) {
    toast('Masukkan setidaknya satu jumlah fisik.');
    return;
  }
  const submitBtn = $('#modalSubmit');
  const finishBtn = $('#finishSession');
  if (submitBtn) submitBtn.disabled = true;
  if (finishBtn) finishBtn.disabled = true;

  try {
    const items = entries.map(input => ({
      productId: input.dataset.countProduct,
      counted: Number(input.value)
    }));

    try {
      await api(`/api/sessions/${encodeURIComponent(id)}/items`, {
        method: 'POST',
        body: JSON.stringify({ items, complete })
      });
    } catch (batchErr) {
      // Fallback to sequential updates if items endpoint is unavailable
      for (const input of entries) {
        await api(`/api/sessions/${encodeURIComponent(id)}/item`, {
          method: 'POST',
          body: JSON.stringify({ productId: input.dataset.countProduct, counted: Number(input.value) })
        });
      }
      if (complete) await api(`/api/sessions/${encodeURIComponent(id)}/complete`, { method: 'POST' });
    }

    closeModal();
    await refresh();
    toast(complete ? 'Stock opname selesai dan stok tersedia diperbarui.' : 'Progres opname tersimpan. Anda bisa melanjutkannya nanti.');
  } catch (e) {
    toast(e.message);
  } finally {
    if (submitBtn) submitBtn.disabled = false;
    if (finishBtn) finishBtn.disabled = false;
  }
}

function downloadCsv(filename, rows) {
  const csv = rows.map(r => r.map(v => `"${String(v ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('File CSV berhasil diunduh.');
}

function exportProducts() {
  downloadCsv('stockly-inventaris.csv', [
    ['SKU', 'Nama Produk', 'Kategori', 'Lokasi', 'Stok Tersedia', 'Stok Minimum', 'Satuan', 'Harga Modal', 'Nilai Stok'],
    ...dashboard.products.map(p => [p.sku, p.name, p.category, p.location, p.stock, p.minStock, p.unit, p.cost, p.stock * p.cost])
  ]);
}

function exportReport() {
  downloadCsv('stockly-laporan-stock-opname.csv', [
    ['SKU', 'Nama Produk', 'Kategori', 'Lokasi', 'Stok Tersedia', 'Stok Minimum', 'Hasil Hitung', 'Selisih', 'Nilai Stok'],
    ...dashboard.products.map(p => [p.sku, p.name, p.category, p.location, p.stock, p.minStock, p.lastCounted ?? '', p.lastVariance ?? '', p.stock * p.cost])
  ]);
}

if ($('#todayDate')) {
  $('#todayDate').textContent = new Intl.DateTimeFormat('id-ID', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date());
}
$$('[data-page]').forEach(el => el.addEventListener('click', e => { e.preventDefault(); go(el.dataset.page); }));
$$('[data-action="new-session"]').forEach(el => el.addEventListener('click', openSessionForm));

$('#mobileMenu')?.addEventListener('click', () => toggleSidebar());
$('#sidebarCloseBtn')?.addEventListener('click', () => toggleSidebar(false));
$('#sidebarBackdrop')?.addEventListener('click', () => toggleSidebar(false));
$('#bottomNavMenuBtn')?.addEventListener('click', () => toggleSidebar(true));
$('#modalBackdrop')?.addEventListener('click', e => { if (e.target.id === 'modalBackdrop') closeModal(); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeModal();
    toggleSidebar(false);
  }
});

$('#addProductBtn')?.addEventListener('click', () => openProductForm());
$('#productSearch')?.addEventListener('input', renderProducts);
$('#categoryFilter')?.addEventListener('change', renderProducts);
$('#stockFilter')?.addEventListener('change', renderProducts);
$('#sessionFilter')?.addEventListener('change', renderSessions);
$('#exportBtn')?.addEventListener('click', exportProducts);
$('#reportExport')?.addEventListener('click', exportReport);
$('#notificationButton')?.addEventListener('click', () => go('settings'));

// Quick Actions Event Listeners
$('#quickActionScan')?.addEventListener('click', openBarcodeScannerModal);
$('#quickActionOpname')?.addEventListener('click', openSessionForm);
$('#quickActionReport')?.addEventListener('click', () => go('reports'));
$('#quickActionAddProduct')?.addEventListener('click', () => openProductForm());
$('#quickActionReset')?.addEventListener('click', openResetDataModal);
$('#openSettingsResetBtn')?.addEventListener('click', openResetDataModal);

// Controls: Date Presets & Picker
$$('#datePresetGroup button').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('#datePresetGroup button').forEach(b => {
      b.className = 'px-2.5 py-1 rounded-md text-gray-600 hover:text-gray-900 transition';
    });
    btn.className = 'px-2.5 py-1 rounded-md bg-white text-gray-900 shadow-sm font-semibold transition';
    activeDateRange = btn.dataset.range;
    renderOverview();
  });
});

$('#dateFilterStart')?.addEventListener('change', e => {
  customDateStart = e.target.value;
  activeDateRange = 'custom';
  $$('#datePresetGroup button').forEach(b => b.className = 'px-2.5 py-1 rounded-md text-gray-600 hover:text-gray-900 transition');
  renderOverview();
});

$('#dateFilterEnd')?.addEventListener('change', e => {
  customDateEnd = e.target.value;
  activeDateRange = 'custom';
  $$('#datePresetGroup button').forEach(b => b.className = 'px-2.5 py-1 rounded-md text-gray-600 hover:text-gray-900 transition');
  renderOverview();
});

$('#btnDateResetToday')?.addEventListener('click', () => {
  activeDateRange = 'today';
  customDateStart = '';
  customDateEnd = '';
  if ($('#dateFilterStart')) $('#dateFilterStart').value = '';
  if ($('#dateFilterEnd')) $('#dateFilterEnd').value = '';
  $$('#datePresetGroup button').forEach(b => {
    b.className = b.dataset.range === 'today'
      ? 'px-2.5 py-1 rounded-md bg-white text-gray-900 shadow-sm font-semibold transition'
      : 'px-2.5 py-1 rounded-md text-gray-600 hover:text-gray-900 transition';
  });
  renderOverview();
});

// Controls: Location Switcher
$('#overviewLocationFilter')?.addEventListener('change', e => {
  activeLocation = e.target.value;
  renderOverview();
});

// Expiring filter buttons
$('#expFilterAll')?.addEventListener('click', () => {
  activeExpFilter = 'all';
  $('#expFilterAll').className = 'px-2.5 py-1 rounded-md bg-gray-100 text-gray-800 font-medium';
  $('#expFilterUrgent').className = 'px-2.5 py-1 rounded-md text-gray-500 hover:bg-gray-50';
  renderExpiringSoon(dashboard.products);
});

$('#expFilterUrgent')?.addEventListener('click', () => {
  activeExpFilter = 'urgent';
  $('#expFilterUrgent').className = 'px-2.5 py-1 rounded-md bg-rose-50 text-rose-700 font-medium border border-rose-200';
  $('#expFilterAll').className = 'px-2.5 py-1 rounded-md text-gray-500 hover:bg-gray-50';
  renderExpiringSoon(dashboard.products);
});

// Movers tabs
$$('#moversTabGroup button').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('#moversTabGroup button').forEach(b => {
      b.className = 'px-2 py-1 rounded-md text-gray-500 hover:text-gray-900';
    });
    btn.className = 'px-2 py-1 rounded-md bg-white font-semibold text-gray-900 shadow-sm';
    activeMoversTab = btn.dataset.moversTab;
    renderMovers(dashboard.products);
  });
});

document.body.addEventListener('click', async e => {
  const edit = e.target.closest('[data-edit]');
  const count = e.target.closest('[data-count]');
  const adjust = e.target.closest('[data-adjust]');
  const del = e.target.closest('[data-delete]');
  const restock = e.target.closest('[data-restock]');
  const approvalAction = e.target.closest('[data-approval-action]');

  if (edit) {
    const p = dashboard.products.find(x => x.id === edit.dataset.edit);
    if (p) openProductForm(p);
  }
  if (count) openCountModal(count.dataset.count);
  if (adjust || restock) {
    const id = (adjust || restock).dataset[adjust ? 'adjust' : 'restock'];
    const p = dashboard.products.find(x => x.id === id);
    if (p) openAdjustForm(p, restock ? Number(restock.dataset.quantity) : null);
  }
  if (del) {
    const p = dashboard.products.find(x => x.id === del.dataset.delete);
    if (p) openDeleteConfirm(p);
  }
  if (approvalAction) {
    const action = approvalAction.dataset.approvalAction;
    const id = approvalAction.dataset.id;
    try {
      await api(`/api/approvals/${encodeURIComponent(id)}/${action}`, { method: 'POST' });
      await refresh();
      toast(`Permintaan berhasil ${action === 'approve' ? 'disetujui' : 'ditolak'}.`);
    } catch (err) {
      toast(err.message);
    }
  }
});

function showAuthMessage(message) {
  $('#authMessage').textContent = message || '';
}

function setAuthMode(mode) {
  authMode = mode;
  const isForgot = mode === 'forgot';
  const registration = mode === 'register';

  if ($('#forgotForm')) $('#forgotForm').hidden = !isForgot;
  if ($('#authForm')) $('#authForm').hidden = isForgot;
  if ($('.auth-tabs')) $('.auth-tabs').hidden = isForgot;

  if (isForgot) {
    $('#authTitle').textContent = 'Lupa Kata Sandi';
    $('#authSubtitle').textContent = 'Kirim kode verifikasi ke email Anda untuk membuat sandi baru.';
    $('#forgotStep1').hidden = false;
    $('#forgotStep2').hidden = true;
    const emailVal = $('#authForm [name="email"]')?.value || '';
    if ($('#forgotEmailInput')) $('#forgotEmailInput').value = emailVal;
  } else {
    if ($('#authNameWrap')) {
      $('#authNameWrap').hidden = !registration;
      const input = $('#authNameWrap input');
      if (input) {
        input.required = registration;
        input.autocomplete = registration ? 'name' : 'off';
      }
    }
    if ($('#authTitle')) $('#authTitle').textContent = registration ? 'Buat Akun Stockly' : 'Selamat datang kembali';
    if ($('#authSubtitle')) $('#authSubtitle').textContent = registration ? 'Daftar untuk mulai mengelola stok gudang.' : 'Masuk ke akun untuk melanjutkan ke dashboard stok.';
    if ($('#authSubmit')) $('#authSubmit').textContent = registration ? 'Buat Akun Baru' : 'Masuk ke Dashboard';
    if ($('#forgotPasswordWrap')) $('#forgotPasswordWrap').hidden = registration;
    $$('[data-auth-mode]').forEach(tab => tab.classList.toggle('selected', tab.dataset.authMode === mode));
  }
  showAuthMessage('');
}

function showAuth() {
  document.body.classList.add('auth-required');
  if ($('#authScreen')) $('#authScreen').hidden = false;
}

async function enterApp(user) {
  currentUser = user;
  if (user?.token) {
    localStorage.setItem('stokly_token', user.token);
  }
  const isAdmin = user.role?.toLowerCase() === 'admin';
  document.body.classList.remove('auth-required');
  if ($('#authScreen')) $('#authScreen').hidden = true;
  if ($('#currentUserName')) $('#currentUserName').textContent = `${user.name} · ${isAdmin ? 'Admin' : 'Pengguna'}`;
  if ($('#welcomeGreeting')?.firstChild) $('#welcomeGreeting').firstChild.textContent = `Selamat datang, ${user.name}! `;
  if ($('.profile strong')) $('.profile strong').textContent = user.name;
  if ($('.profile small')) $('.profile small').textContent = isAdmin ? 'Administrator' : (user.role || 'Pengguna');
  const initials = user.name.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
  if ($('.avatar')) $('.avatar').textContent = initials;
  if ($('.top-avatar')) $('.top-avatar').textContent = initials;
  $$('.admin-only').forEach(el => el.hidden = !isAdmin);
  go(location.hash.slice(1) === 'admin' && isAdmin ? 'admin' : 'overview');
  await refresh();
  await refreshPushState();
}

function switchToSetup(show) {
  if ($('#adminSetupForm')) $('#adminSetupForm').hidden = !show;
  if ($('#authForm')) $('#authForm').hidden = show;
  if ($('#forgotForm')) $('#forgotForm').hidden = true;
  if ($('.auth-tabs')) $('.auth-tabs').hidden = show;
  if ($('#adminSetupCallout')) $('#adminSetupCallout').hidden = show || $('#adminSetupCallout').dataset.setup !== 'true';
  showAuthMessage('');
}

async function initializeApp() {
  try {
    if ('serviceWorker' in navigator) {
      serviceWorkerRegistration = await navigator.serviceWorker.register('/service-worker.js').catch(error => {
        console.warn('Service worker belum tersedia:', error.message);
        return null;
      });
    }
    const state = await api('/api/auth/status');
    if (state.setupNeeded) {
      if ($('#adminSetupCallout')) {
        $('#adminSetupCallout').hidden = false;
        $('#adminSetupCallout').dataset.setup = 'true';
      }
    } else {
      if ($('#adminSetupCallout')) $('#adminSetupCallout').hidden = true;
    }
    if (state.user) await enterApp(state.user);
    else showAuth();
  } catch (error) {
    showAuth();
    showAuthMessage(`Tidak dapat terhubung ke server: ${error.message}`);
  }
}

$$('[data-auth-mode]').forEach(tab => tab.addEventListener('click', e => {
  e.preventDefault();
  setAuthMode(tab.dataset.authMode);
}));
$('#showAdminSetup')?.addEventListener('click', () => switchToSetup(true));
$('#backToLogin')?.addEventListener('click', () => switchToSetup(false));

$('#forgotPasswordBtn')?.addEventListener('click', e => {
  e.preventDefault();
  setAuthMode('forgot');
});
$('#backToLoginFromForgot')?.addEventListener('click', e => {
  e.preventDefault();
  setAuthMode('login');
});

$('#btnSendResetCode')?.addEventListener('click', async () => {
  const emailInput = $('#forgotEmailInput');
  if (!emailInput || !emailInput.reportValidity()) return;
  const email = emailInput.value.trim().toLowerCase();
  showAuthMessage('');
  try {
    const btn = $('#btnSendResetCode');
    btn.disabled = true;
    btn.textContent = 'Mengirim kode...';
    const res = await api('/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email })
    });
    $('#forgotStep1').hidden = true;
    $('#forgotStep2').hidden = false;
    if (res.code) {
      $('#forgotCodeInput').value = res.code;
    }
    toast(res.message || 'Kode verifikasi telah dikirim.');
    if ($('#forgotCodeNotice')) {
      $('#forgotCodeNotice').textContent = `Kode verifikasi 6 digit telah dikirim ke ${email}. (Kode Uji: ${res.code || 'cek email'})`;
    }
  } catch (err) {
    showAuthMessage(err.message);
  } finally {
    const btn = $('#btnSendResetCode');
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Kirim Kode Verifikasi';
    }
  }
});

$('#btnSubmitNewPassword')?.addEventListener('click', async () => {
  const email = $('#forgotEmailInput')?.value.trim().toLowerCase();
  const code = $('#forgotCodeInput')?.value.trim();
  const newPass = $('#forgotNewPasswordInput')?.value;

  if (!code || code.length !== 6) {
    showAuthMessage('Masukkan 6 digit kode verifikasi.');
    return;
  }
  if (!newPass || newPass.length < 8) {
    showAuthMessage('Kata sandi baru minimal 8 karakter.');
    return;
  }

  showAuthMessage('');
  try {
    const btn = $('#btnSubmitNewPassword');
    btn.disabled = true;
    btn.textContent = 'Menyimpan...';
    const res = await api('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ email, code, newPassword: newPass })
    });
    toast('Kata sandi berhasil diperbarui.');
    if (res.user) {
      await enterApp(res.user);
    } else {
      setAuthMode('login');
      toast('Silakan masuk dengan kata sandi baru Anda.');
    }
  } catch (err) {
    showAuthMessage(err.message);
  } finally {
    const btn = $('#btnSubmitNewPassword');
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Simpan Kata Sandi Baru';
    }
  }
});

$('#authForm').addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.currentTarget, data = Object.fromEntries(new FormData(form));
  const endpoint = authMode === 'register' ? '/api/auth/register' : '/api/auth/login';
  try {
    const result = await api(endpoint, { method: 'POST', body: JSON.stringify(data) });
    if (result.token) localStorage.setItem('stokly_token', result.token);
    form.reset();
    await enterApp(result.user);
    toast(`Selamat datang, ${result.user.name}.`);
  } catch (error) {
    showAuthMessage(error.message);
  }
});

$('#adminSetupForm').addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.currentTarget;
  try {
    const result = await api('/api/auth/setup', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) });
    if (result.token) localStorage.setItem('stokly_token', result.token);
    await enterApp(result.user);
    toast('Akun admin berhasil dibuat.');
  } catch (error) {
    showAuthMessage(error.message);
  }
});

async function logout(event) {
  event?.preventDefault();
  event?.stopPropagation();
  const buttons = [$('#logoutButton'), $('#sidebarLogout')].filter(Boolean);
  buttons.forEach(button => {
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
  });
  try {
    await api('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    localStorage.removeItem('stokly_token');
    currentUser = null;
    document.body.classList.add('auth-required');
    $('#authScreen').hidden = false;
    location.hash = '';
    setAuthMode('login');
    toast('Anda sudah keluar.');
  } catch (error) {
    localStorage.removeItem('stokly_token');
    currentUser = null;
    document.body.classList.add('auth-required');
    $('#authScreen').hidden = false;
    toast(`Keluar: ${error.message}`);
  } finally {
    buttons.forEach(button => {
      button.disabled = false;
      button.removeAttribute('aria-busy');
    });
  }
}
window.logoutStockly = logout;
$('#logoutButton')?.addEventListener('click', logout);
$('#sidebarLogout')?.addEventListener('click', logout);

async function loadMyFeedback() {
  try {
    const items = await api('/api/feedback');
    $('#myFeedbackList').innerHTML = items.map(item => `
      <article class="feedback-item">
        <div class="feedback-item-head">
          <strong>${esc(item.category)}</strong>
          <span class="badge ${item.status === 'Selesai' ? 'done' : 'progress'}">${esc(item.status)}</span>
        </div>
        <p>${esc(item.message)}</p>
        <small>${dateShort(item.createdAt)}</small>
      </article>
    `).join('') || '<div class="empty-state">Belum ada masukan yang dikirim.</div>';
  } catch (error) {
    toast(error.message);
  }
}

$('#feedbackForm').addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.currentTarget;
  try {
    await api('/api/feedback', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) });
    form.reset();
    await loadMyFeedback();
    toast('Terima kasih, masukan Anda sudah dikirim ke admin.');
  } catch (error) {
    toast(error.message);
  }
});

// Admin Monitoring & RBAC Multi-Admin Management
async function loadAdmin() {
  if (currentUser?.role?.toLowerCase() !== 'admin') return;
  try {
    const data = await api('/api/admin/overview');
    $('#adminUsers').textContent = data.stats.users;
    $('#adminFeedbackCount').textContent = data.stats.feedback;
    $('#adminErrorsCount').textContent = data.stats.errors;
    $('#adminSessions').textContent = data.stats.activeSessions;
    const uptime = Math.floor(data.stats.uptime || 0);
    $('#adminUptime').textContent = uptime < 3600 ? `${Math.floor(uptime / 60)} mnt` : `${Math.floor(uptime / 3600)} jam`;
    $('#adminNode').textContent = `Backend aktif · ${data.stats.node}`;
    $('#adminAlertCount').textContent = data.stats.feedback + data.stats.errors;

    $('#adminFeedbackRows').innerHTML = data.feedback.map(f => `
      <tr>
        <td><span class="text-gray-600 font-medium">${dateShort(f.createdAt)}</span></td>
        <td><strong class="text-gray-900">${esc(f.name)}</strong><div class="text-xs text-gray-400">${esc(f.email)}</div></td>
        <td><span class="text-xs font-semibold px-2 py-0.5 bg-gray-100 text-gray-700 rounded">${esc(f.category)}</span></td>
        <td class="admin-message" title="${esc(f.message)}">${esc(f.message.slice(0, 140))}${f.message.length > 140 ? '…' : ''}</td>
        <td class="text-center"><span class="badge ${f.status === 'Selesai' ? 'done' : f.status === 'Baru' ? 'low' : 'progress'}">${esc(f.status)}</span></td>
        <td class="text-right">${f.status === 'Selesai' ? '<span class="text-gray-400 text-xs">Selesai</span>' : `<button class="button secondary text-xs py-1 px-3" data-feedback-done="${esc(f.id)}">Tandai Selesai</button>`}</td>
      </tr>
    `).join('') || '<tr><td colspan="6" class="empty-state">Belum ada kritik atau saran.</td></tr>';

    $('#adminErrorRows').innerHTML = data.errors.map(err => `
      <tr>
        <td><span class="text-gray-600 font-medium">${dateShort(err.createdAt)}</span></td>
        <td><span class="text-gray-800 font-medium">${esc(data.users.find(u => u.id === err.userId)?.name || err.source)}</span></td>
        <td><span class="sku">${esc(err.page || '—')}</span></td>
        <td class="admin-message text-rose-700 font-mono text-xs" title="${esc(err.stack || '')}">${esc(err.message)}</td>
        <td class="text-center"><span class="badge ${err.status === 'Ditinjau' ? 'done' : 'low'}">${esc(err.status)}</span></td>
        <td class="text-right">${err.status === 'Baru' ? `<button class="button secondary text-xs py-1 px-3" data-error-review="${esc(err.id)}">Tandai Ditinjau</button>` : '<span class="text-gray-400 text-xs">Selesai</span>'}</td>
      </tr>
    `).join('') || '<tr><td colspan="6" class="empty-state">Belum ada error yang tercatat.</td></tr>';

    // Multi-Admin RBAC table
    $('#adminUserRows').innerHTML = data.users.map(u => {
      const isSelf = u.id === currentUser.id;
      return `
        <tr>
          <td><strong class="text-gray-900">${esc(u.name)}</strong>${isSelf ? ' <span class="text-xs font-bold text-red-600 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded ml-1">Akun Anda</span>' : ''}</td>
          <td><span class="text-gray-600">${esc(u.email)}</span></td>
          <td class="text-center"><span class="badge ${u.role === 'admin' ? 'progress' : 'ok'}">${esc(u.role || 'user')}</span></td>
          <td><span class="text-gray-600">${dateShort(u.createdAt)}</span></td>
          <td class="text-right">
            <select class="role-select bg-white border border-gray-300 text-xs font-medium rounded px-2.5 py-1 outline-none cursor-pointer focus:border-red-500" data-user-role-id="${esc(u.id)}" ${isSelf ? 'disabled title="Anda tidak dapat mengubah peran akun sendiri"' : ''}>
              <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin (Pimpinan)</option>
              <option value="manager" ${u.role === 'manager' ? 'selected' : ''}>Manager</option>
              <option value="staff" ${u.role === 'staff' ? 'selected' : ''}>Staff</option>
              <option value="user" ${u.role === 'user' ? 'selected' : ''}>User (Biasa)</option>
            </select>
          </td>
        </tr>
      `;
    }).join('') || '<tr><td colspan="5" class="empty-state">Belum ada pengguna.</td></tr>';
  } catch (error) {
    toast(error.message);
  }
}

$('#refreshAdmin').addEventListener('click', loadAdmin);

// Role Change handler
document.body.addEventListener('change', async e => {
  const roleSelect = e.target.closest('[data-user-role-id]');
  if (roleSelect) {
    const userId = roleSelect.dataset.userRoleId;
    const newRole = roleSelect.value;
    try {
      await api(`/api/admin/users/${encodeURIComponent(userId)}/role`, {
        method: 'PUT',
        body: JSON.stringify({ role: newRole })
      });
      toast(`Peran pengguna berhasil diubah menjadi ${newRole}.`);
      await loadAdmin();
    } catch (err) {
      toast(err.message);
      await loadAdmin();
    }
  }
});

// Admin adds new user/admin directly
$('#addAdminUserBtn')?.addEventListener('click', () => {
  modalFrame(
    'Tambah Admin / Staf Baru',
    'Buat akun baru dengan peran tertentu langsung dari dashboard Admin.',
    `
      <form id="addAdminUserForm" class="form-grid">
        <div class="form-field full"><label>Nama lengkap *</label><input name="name" required placeholder="Nama pimpinan atau staf"></div>
        <div class="form-field full"><label>Email *</label><input name="email" type="email" required placeholder="pimpinan@perusahaan.com"></div>
        <div class="form-field"><label>Kata Sandi *</label><input name="password" type="password" required minlength="8" placeholder="Minimal 8 karakter"></div>
        <div class="form-field"><label>Peran (Role) *</label>
          <select name="role">
            <option value="admin">Admin (Akses Penuh)</option>
            <option value="manager">Manager</option>
            <option value="staff">Staff</option>
            <option value="user">User Biasa</option>
          </select>
        </div>
      </form>
    `,
    'Buat Akun'
  );

  $('#modalSubmit').addEventListener('click', async () => {
    const f = $('#addAdminUserForm');
    if (!f.reportValidity()) return;
    try {
      const data = Object.fromEntries(new FormData(f));
      await api('/api/admin/users', { method: 'POST', body: JSON.stringify(data) });
      closeModal();
      await loadAdmin();
      toast(`Akun ${data.name} (${data.role}) berhasil ditambahkan.`);
    } catch (err) {
      toast(err.message);
    }
  });
});

document.body.addEventListener('click', async e => {
  const feedback = e.target.closest('[data-feedback-done]');
  const error = e.target.closest('[data-error-review]');
  try {
    if (feedback) {
      await api(`/api/admin/feedback/${encodeURIComponent(feedback.dataset.feedbackDone)}`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'Selesai' })
      });
      await loadAdmin();
    }
    if (error) {
      await api(`/api/admin/errors/${encodeURIComponent(error.dataset.errorReview)}`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'Ditinjau' })
      });
      await loadAdmin();
    }
  } catch (err) {
    toast(err.message);
  }
});

function base64ToBytes(value) {
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const raw = atob(value.replace(/-/g, '+').replace(/_/g, '/') + padding);
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

async function refreshPushState() {
  const btn = $('#enableNotifications'), status = $('#pushStatus'), test = $('#testNotification');
  if (!btn || !currentUser) return;
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    status.textContent = 'Browser ini belum mendukung notifikasi web. Coba Chrome atau pasang aplikasi dari browser HP.';
    btn.disabled = true;
    return;
  }
  const reg = serviceWorkerRegistration || await navigator.serviceWorker.ready;
  const subscription = await reg.pushManager.getSubscription();
  btn.textContent = subscription ? 'Nonaktifkan Notifikasi' : 'Aktifkan Notifikasi';
  status.textContent = subscription ? 'Notifikasi aktif di perangkat ini.' : 'Izinkan notifikasi agar pembaruan penting bisa muncul di perangkat ini.';
  test.hidden = !subscription;
}

$('#enableNotifications')?.addEventListener('click', async () => {
  try {
    if (!window.isSecureContext) throw new Error('Notifikasi HP perlu situs HTTPS. Gunakan alamat publik setelah aplikasi dipublikasikan.');
    const reg = serviceWorkerRegistration || await navigator.serviceWorker.ready;
    let subscription = await reg.pushManager.getSubscription();
    if (subscription) {
      await api('/api/push/subscribe', { method: 'DELETE', body: JSON.stringify({ endpoint: subscription.endpoint }) });
      await subscription.unsubscribe();
      toast('Notifikasi dimatikan di perangkat ini.');
    } else {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('Izin notifikasi belum diberikan di browser.');
      const key = await api('/api/push/key');
      const applicationServerKey = base64ToBytes(key.publicKey);
      subscription = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
      await api('/api/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription }) });
      toast('Notifikasi aktif di perangkat ini.');
    }
    await refreshPushState();
  } catch (error) {
    toast(error.message);
  }
});

$('#testNotification')?.addEventListener('click', async () => {
  try {
    await api('/api/push/test', { method: 'POST' });
    toast('Notifikasi uji dikirim.');
  } catch (error) {
    toast(error.message);
  }
});

window.addEventListener('error', e => {
  if (currentUser) {
    api('/api/client-errors', {
      method: 'POST',
      body: JSON.stringify({ message: e.message, stack: e.error?.stack || '', page: location.hash })
    }).catch(() => {});
  }
});

window.addEventListener('unhandledrejection', e => {
  if (currentUser) {
    api('/api/client-errors', {
      method: 'POST',
      body: JSON.stringify({ message: String(e.reason?.message || e.reason || 'Unhandled promise rejection'), stack: e.reason?.stack || '', page: location.hash })
    }).catch(() => {});
  }
});

// Zoho Topbar event handlers
$('#topQuickAdd')?.addEventListener('click', () => {
  $('#quickActionAddProduct')?.click();
});

$('#topSettingsBtn')?.addEventListener('click', () => {
  location.hash = '#settings';
});

$('#globalSearchInput')?.addEventListener('input', e => {
  const query = e.target.value.toLowerCase().trim();
  if (query) {
    location.hash = '#products';
    const pSearch = $('#productSearch');
    if (pSearch) {
      pSearch.value = query;
      pSearch.dispatchEvent(new Event('input'));
    }
  }
});

initializeApp();

