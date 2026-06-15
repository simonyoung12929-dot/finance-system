const API = '/api';
let token = localStorage.getItem('token');
let currentYear, currentMonth;
let currentPage = 'dashboard';
let employees = [];
let annualEmpData = [];
let empTableData = [];  // 当前月员工数据（供排序用）
let empMgmtCache = [];
let empMgmtSortKey = 'name';
let empMgmtSortDesc = false;
let empSortKey = 'profit_ratio';
let empSortDesc = true;
let annualSortKey = 'total_profit';
let annualSortDesc = true;
let pieChart, trendChart, empBarChart, annualTrendChart;

// ===== 初始化 =====
(function init() {
  if (!token) { window.location.href = '/'; return; }

  const username = localStorage.getItem('username') || 'user';
  const role = localStorage.getItem('role');
  document.getElementById('userName').textContent = username;
  document.getElementById('userAvatar').textContent = username[0].toUpperCase();

  if (role === 'admin') {
    document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'flex');
  }

  const now = new Date();
  currentYear = now.getFullYear();
  currentMonth = now.getMonth() + 1;

  ['selYear', 'uploadYear', 'manualYear', 'annualYear', 'clearYear'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    for (let y = now.getFullYear(); y >= 2023; y--) {
      sel.innerHTML += `<option value="${y}">${y}年</option>`;
    }
  });

  // 月份按钮
  const btnContainer = document.getElementById('monthBtns');
  for (let m = 1; m <= 12; m++) {
    const btn = document.createElement('button');
    btn.className = 'month-btn' + (m === currentMonth ? ' active' : '');
    btn.textContent = m + '月';
    btn.dataset.month = m;
    btn.onclick = () => selectMonth(m);
    btnContainer.appendChild(btn);
  }

  document.getElementById('manualMonth').value = currentMonth;

  document.querySelectorAll('.nav-item[data-page]').forEach(item => {
    item.addEventListener('click', () => switchPage(item.dataset.page));
  });

  const zone = document.getElementById('uploadZone');
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('dragover');
    if (e.dataTransfer.files[0]) uploadFile(e.dataTransfer.files[0]);
  });

  document.getElementById('manualEmployee').addEventListener('change', function() {
    const emp = employees.find(e => e.id == this.value);
    if (emp) {
      document.getElementById('previewRate').textContent = emp.daily_rate;
      document.getElementById('manualPreview').style.display = 'block';
      calcManualPreview();
    } else {
      document.getElementById('manualPreview').style.display = 'none';
    }
  });

  ['clearYear', 'clearMonth', 'clearEmployee'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', updateClearPreview);
  });

  loadEmployees();
  loadCurrentMonth();
})();

function logout() { localStorage.clear(); window.location.href = '/'; }

function switchPage(page) {
  currentPage = page;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  document.querySelector(`[data-page="${page}"]`).classList.add('active');

  const hideBar = page === 'employees' || page === 'data-manage';
  document.getElementById('monthSelectorBar').style.display = hideBar ? 'none' : '';

  if (page === 'employees') loadEmpMgmt();
  if (page === 'employees-profit') loadEmployeeProfit();
  if (page === 'annual') loadAnnual();
  if (page === 'data-manage') loadDataManage();
}

function queryCurrentPage() {
  if (currentPage === 'dashboard') loadCurrentMonth();
  else if (currentPage === 'employees-profit') { loadCurrentMonth(); loadEmployeeProfit(); }
  else if (currentPage === 'annual') loadAnnual();
  else loadCurrentMonth();
}

// selYear 变化时实时刷新（仅在相关页面）
document.getElementById('selYear').addEventListener('change', queryCurrentPage);

// ===== API =====
async function api(method, path, body) {
  const opts = { method, headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(API + path, opts);
  if (res.status === 401) { localStorage.clear(); window.location.href = '/'; }
  return res.json();
}

async function apiUpload(path, formData) {
  const res = await fetch(API + path, { method: 'POST', headers: { 'Authorization': `Bearer ${token}` }, body: formData });
  if (res.status === 401) { localStorage.clear(); window.location.href = '/'; }
  return res.json();
}

// ===== 格式化 =====
function fmt(n) {
  if (n === null || n === undefined || isNaN(parseFloat(n))) return '--';
  return '¥' + parseFloat(n).toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function fmtRatio(n) {
  if (n === null || n === undefined || isNaN(parseFloat(n))) return '--';
  return (parseFloat(n) * 100).toFixed(1) + '%';
}
function ratioBadge(r) {
  const pct = parseFloat(r) * 100;
  if (isNaN(pct)) return '<span class="ratio-badge ratio-low">--</span>';
  if (pct >= 35) return `<span class="ratio-badge ratio-high">${fmtRatio(r)}</span>`;
  if (pct >= 10) return `<span class="ratio-badge ratio-mid">${fmtRatio(r)}</span>`;
  return `<span class="ratio-badge ratio-low">${fmtRatio(r)}</span>`;
}
function typeBadge(t) {
  const color = t === '外包' ? '#f59e0b' : '#3b82f6';
  return `<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;background:${color}20;color:${color}">${t || '外派'}</span>`;
}
function statusTag(s) {
  const map = { '已支付': 'tag-paid', '已开票': 'tag-invoiced', '已确认': 'tag-invoiced', '未结算': 'tag-none' };
  return `<span class="tag ${map[s] || 'tag-pending'}">${s || '--'}</span>`;
}
function selectMonth(m) {
  currentMonth = m;
  document.querySelectorAll('.month-btn').forEach(b => b.classList.toggle('active', parseInt(b.dataset.month) === m));
  queryCurrentPage();
}

function getSelYearMonth() {
  return { year: document.getElementById('selYear').value, month: currentMonth };
}
function sortArrow(key, currentKey, desc) {
  if (key !== currentKey) return '<span style="color:var(--gray-300);font-size:10px">⇅</span>';
  return desc ? '↓' : '↑';
}

// ===== 员工列表 =====
async function loadEmployees() {
  try {
    const all = await api('GET', '/employees');
    employees = all.filter(e => !e.resigned_date && e.is_active !== false);
    updateEmployeeSelects();
    updateClearEmployeeSelect();
  } catch (e) { console.error(e); }
}

function updateEmployeeSelects() {
  const typeFilter = document.getElementById('manualEmpType')?.value || '';
  const filtered = typeFilter ? employees.filter(e => e.employee_type === typeFilter) : employees;
  const sel = document.getElementById('manualEmployee');
  sel.innerHTML = '<option value="">选择员工...</option>';
  filtered.forEach(e => {
    sel.innerHTML += `<option value="${e.id}">[${e.employee_type || '外派'}] ${e.name}（¥${e.daily_rate}/天）</option>`;
  });
}

function filterManualEmployees() {
  updateEmployeeSelects();
  document.getElementById('manualPreview').style.display = 'none';
  document.getElementById('manualCalcResult').style.display = 'none';
}

function updateClearEmployeeSelect() {
  const sel = document.getElementById('clearEmployee');
  if (!sel) return;
  sel.innerHTML = '<option value="">所有员工</option>';
  employees.forEach(e => {
    sel.innerHTML += `<option value="${e.id}">[${e.employee_type || '外派'}] ${e.name}</option>`;
  });
}

// ===== 月度仪表盘 =====
async function loadCurrentMonth() {
  const { year, month } = getSelYearMonth();
  currentYear = year; currentMonth = month;
  try {
    const data = await api('GET', `/finance/summary/${year}/${month}`);
    renderDashboard(data, year, month);
    loadTrend();
  } catch(e) { console.error(e); }
}

function renderDashboard(data, year, month) {
  document.getElementById('dashboardSubtitle').textContent = `${year}年${month}月 财务汇总`;

  // 优先用 monthly_finance 记录；没有则从员工外派数据推算，外包/开支默认为 0
  const emps = data.employees || [];
  const dispatchRevenue = emps.reduce((s, e) => s + parseFloat(e.revenue || 0), 0);
  const salaryCost = emps.reduce((s, e) => s + parseFloat(e.cost || 0), 0);

  const f = data.finance ? {
    total_revenue: parseFloat(data.finance.total_revenue),
    outsource_revenue: parseFloat(data.finance.outsource_revenue),
    total_salary_cost: parseFloat(data.finance.total_salary_cost),
    fixed_expense: parseFloat(data.finance.fixed_expense),
    other_expense: parseFloat(data.finance.other_expense),
    total_profit: parseFloat(data.finance.total_profit),
    profit_rate: parseFloat(data.finance.profit_rate),
    notes: data.finance.notes
  } : {
    total_revenue: dispatchRevenue,
    outsource_revenue: 0,
    total_salary_cost: salaryCost,
    fixed_expense: 0,
    other_expense: 0,
    total_profit: dispatchRevenue - salaryCost,
    profit_rate: dispatchRevenue > 0 ? (dispatchRevenue - salaryCost) / dispatchRevenue : 0,
    notes: null
  };

  const profit = f.total_profit;
  document.getElementById('totalProfit').textContent = fmt(profit);
  document.getElementById('totalProfit').className = 'value ' + (profit >= 0 ? '' : 'loss');
  document.getElementById('profitRate').textContent = '利润率 ' + fmtRatio(f.profit_rate);
  document.getElementById('totalRevenue').textContent = fmt(f.total_revenue);
  document.getElementById('revenueBreakdown').textContent = `外派 ${fmt(f.total_revenue - f.outsource_revenue)} + 外包 ${fmt(f.outsource_revenue)}`;
  document.getElementById('salaryCost').textContent = fmt(f.total_salary_cost);
  document.getElementById('otherExpense').textContent = fmt(f.fixed_expense + f.other_expense);
  document.getElementById('financeDetail').innerHTML = data.finance ? `
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;font-size:13px;">
      <div><span style="color:var(--gray-500)">外包收入：</span><strong>${fmt(f.outsource_revenue)}</strong></div>
      <div><span style="color:var(--gray-500)">固定开支：</span><strong>${fmt(f.fixed_expense)}</strong></div>
      <div><span style="color:var(--gray-500)">变动支出：</span><strong>${fmt(f.other_expense)}</strong></div>
      ${f.notes ? `<div style="grid-column:1/-1;color:var(--gray-500)">备注：${f.notes}</div>` : ''}
    </div>` : `<p style="color:var(--gray-400);font-size:13px">未录入外包收入和其他开支，以上数据仅含员工外派部分。点击"编辑"可补充录入。</p>`;
  renderPieChart(f);
}

function renderPieChart(f) {
  const ctx = document.getElementById('expensePieChart').getContext('2d');
  if (pieChart) pieChart.destroy();
  const salary = parseFloat(f.total_salary_cost) || 0;
  const fixed = parseFloat(f.fixed_expense) || 0;
  const other = parseFloat(f.other_expense) || 0;
  const profit = Math.max(0, parseFloat(f.total_profit) || 0);
  pieChart = new Chart(ctx, {
    type: 'doughnut',
    data: { labels: ['员工工资','固定开支','其他支出','利润'], datasets: [{ data:[salary,fixed,other,profit], backgroundColor:['#3b82f6','#f59e0b','#ef4444','#22c55e'], borderWidth:0 }] },
    options: { plugins: { legend: { position:'bottom', labels:{ font:{size:12} } } }, cutout:'60%' }
  });
}

async function loadTrend() {
  const trend = await api('GET', '/finance/trend');
  const ctx = document.getElementById('trendChart').getContext('2d');
  if (trendChart) trendChart.destroy();
  if (!trend?.length) return;
  trendChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: trend.map(t => `${t.year}/${t.month}`),
      datasets: [
        { label:'总收入', data:trend.map(t=>t.total_revenue), borderColor:'#3b82f6', backgroundColor:'rgba(59,130,246,0.1)', tension:0.3, fill:true },
        { label:'净利润', data:trend.map(t=>t.total_profit), borderColor:'#22c55e', backgroundColor:'rgba(34,197,94,0.1)', tension:0.3, fill:true }
      ]
    },
    options: { plugins:{legend:{position:'bottom'}}, scales:{y:{ticks:{callback:v=>'¥'+(v/10000).toFixed(0)+'w'}}} }
  });
}

// ===== 年度报告 =====
async function loadAnnual() {
  const sel = document.getElementById('annualYear');
  if (!sel) return;
  const year = sel.value;
  try {
    const data = await api('GET', `/finance/annual/${year}`);
    if (data.error) { console.error(data.error); return; }

    annualEmpData = data.topEmployees || [];
    const s = data.summary;

    document.getElementById('annualStats').style.display = 'grid';
    document.getElementById('annualCharts').style.display = 'grid';
    document.getElementById('annualEmpCard').style.display = 'block';
    document.getElementById('annualMonthCard').style.display = 'block';

    document.getElementById('annualProfit').textContent = fmt(s.total_profit);
    document.getElementById('annualProfit').className = 'value ' + (parseFloat(s.total_profit) >= 0 ? '' : 'loss');
    document.getElementById('annualProfitRate').textContent = '利润率 ' + fmtRatio(s.profit_rate);
    document.getElementById('annualRevenue').textContent = fmt(s.total_revenue);
    document.getElementById('annualRevBreak').textContent = `外派 ${fmt(s.total_revenue - s.outsource_revenue)} + 外包 ${fmt(s.outsource_revenue)}`;
    document.getElementById('annualSalary').textContent = fmt(s.total_salary_cost);
    document.getElementById('annualMonthsCount').textContent = `共 ${s.months_count} 个月有数据`;
    document.getElementById('annualExpense').textContent = fmt(parseFloat(s.fixed_expense) + parseFloat(s.other_expense));
    document.getElementById('annualEmpTitle').textContent = `${year}年 员工年度收益排行`;

    const ctx = document.getElementById('annualTrendChart').getContext('2d');
    if (annualTrendChart) annualTrendChart.destroy();
    const months = data.byMonth || [];
    if (months.length) {
      annualTrendChart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: months.map(m => `${m.month}月`),
          datasets: [
            { label:'总收入', data:months.map(m=>m.total_revenue), backgroundColor:'#bfdbfe', order:2 },
            { label:'净利润', data:months.map(m=>m.total_profit), backgroundColor:months.map(m=>parseFloat(m.total_profit)>=0?'#22c55e':'#ef4444'), order:2 },
            { type:'line', label:'利润率', data:months.map(m=>parseFloat(m.profit_rate)*100), borderColor:'#f59e0b', yAxisID:'y1', tension:0.3, order:1 }
          ]
        },
        options: {
          plugins:{legend:{position:'bottom'}},
          scales:{ y:{ticks:{callback:v=>'¥'+(v/10000).toFixed(0)+'w'}}, y1:{position:'right',ticks:{callback:v=>v.toFixed(0)+'%'},grid:{drawOnChartArea:false}} }
        }
      });
    }

    renderAnnualEmpTable();
    renderAnnualMonthTable(months);
  } catch(e) { console.error('年报加载失败', e); }
}

function sortAnnualBy(key) {
  if (annualSortKey === key) annualSortDesc = !annualSortDesc;
  else { annualSortKey = key; annualSortDesc = true; }
  renderAnnualEmpTable();
}

function renderAnnualEmpTable() {
  const filter = document.getElementById('annualEmpFilter').value;
  let rows = filter ? annualEmpData.filter(e => e.employee_type === filter) : [...annualEmpData];
  rows.sort((a, b) => {
    const av = parseFloat(a[annualSortKey]) || 0;
    const bv = parseFloat(b[annualSortKey]) || 0;
    return annualSortDesc ? bv - av : av - bv;
  });

  const sa = (k) => sortArrow(k, annualSortKey, annualSortDesc);
  const th = 'cursor:pointer;user-select:none;white-space:nowrap';

  document.getElementById('annualEmpThead').innerHTML = `<tr>
    <th>排名</th><th>姓名</th><th>类型</th>
    <th style="${th}" onclick="sortAnnualBy('total_days')">年度人天 ${sa('total_days')}</th>
    <th style="${th}" onclick="sortAnnualBy('total_revenue')">年度结算额 ${sa('total_revenue')}</th>
    <th style="${th}" onclick="sortAnnualBy('total_cost')">年度成本 ${sa('total_cost')}</th>
    <th style="${th}" onclick="sortAnnualBy('total_profit')">年度盈利 ${sa('total_profit')}</th>
    <th style="${th}" onclick="sortAnnualBy('avg_ratio')">平均收益比 ${sa('avg_ratio')}</th>
  </tr>`;

  document.getElementById('annualEmpBody').innerHTML = rows.length ? rows.map((r, i) => `
    <tr>
      <td style="color:var(--gray-400);font-weight:600">${i+1}</td>
      <td style="font-weight:600">${r.name}</td>
      <td>${typeBadge(r.employee_type)}</td>
      <td>${parseFloat(r.total_days||0).toFixed(1)} 天</td>
      <td>${fmt(r.total_revenue)}</td>
      <td>${fmt(r.total_cost)}</td>
      <td style="font-weight:700;color:${parseFloat(r.total_profit)>=0?'var(--success)':'var(--danger)'}">${fmt(r.total_profit)}</td>
      <td>${ratioBadge(r.avg_ratio)}</td>
    </tr>`).join('')
    : '<tr><td colspan="8" style="text-align:center;padding:30px;color:var(--gray-500)">暂无数据</td></tr>';
}

// ===== 导出 Excel =====
async function exportExcel() {
  const year = document.getElementById('annualYear')?.value || document.getElementById('selYear').value;
  const btn = event.target;
  btn.textContent = '导出中...';
  btn.disabled = true;
  try {
    const res = await fetch(`${API}/finance/export/${year}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) throw new Error('导出失败');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${year}年财务数据.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert('导出失败：' + e.message);
  } finally {
    btn.textContent = '↓ 导出 Excel';
    btn.disabled = false;
  }
}

function renderAnnualMonthTable(months) {
  document.getElementById('annualMonthBody').innerHTML = months.length ? months.map(m => `
    <tr>
      <td style="font-weight:600">${m.month}月</td>
      <td>${fmt(m.total_revenue)}</td>
      <td>${fmt(m.outsource_revenue)}</td>
      <td>${fmt(m.total_salary_cost)}</td>
      <td>${fmt(parseFloat(m.fixed_expense)+parseFloat(m.other_expense))}</td>
      <td style="font-weight:700;color:${parseFloat(m.total_profit)>=0?'var(--success)':'var(--danger)'}">${fmt(m.total_profit)}</td>
      <td>${ratioBadge(m.profit_rate)}</td>
    </tr>`).join('')
    : '<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--gray-500)">暂无月度财务数据</td></tr>';
}

// ===== 员工收益比 =====
async function loadEmployeeProfit() {
  const { year, month } = getSelYearMonth();
  const typeFilter = document.getElementById('empTypeFilter')?.value || '';
  try {
    const data = await api('GET', `/finance/summary/${year}/${month}`);
    empTableData = data.employees || [];
    if (typeFilter) empTableData = empTableData.filter(e => e.employee_type === typeFilter);
    document.getElementById('empTableTitle').textContent = `${year}年${month}月 员工收益明细`;
    empSortKey = 'profit_ratio'; empSortDesc = true;
    renderEmpTable();
    renderEmpBarChart(empTableData);
  } catch(e) { console.error(e); }
}

function sortEmpBy(key) {
  if (empSortKey === key) empSortDesc = !empSortDesc;
  else { empSortKey = key; empSortDesc = true; }
  renderEmpTable();
}

function renderEmpTable() {
  const rows = [...empTableData].sort((a, b) => {
    const av = parseFloat(a[empSortKey]) || 0;
    const bv = parseFloat(b[empSortKey]) || 0;
    return empSortDesc ? bv - av : av - bv;
  });

  const sa = (k) => sortArrow(k, empSortKey, empSortDesc);
  const thStyle = 'cursor:pointer;user-select:none;white-space:nowrap';

  document.getElementById('empTableThead').innerHTML = `
    <tr>
      <th>排名</th><th>姓名</th><th>类型</th><th>项目</th>
      <th style="${thStyle}" onclick="sortEmpBy('daily_rate')">人天单价 ${sa('daily_rate')}</th>
      <th style="${thStyle}" onclick="sortEmpBy('dispatch_days')">结算人天 ${sa('dispatch_days')}</th>
      <th style="${thStyle}" onclick="sortEmpBy('revenue')">结算金额 ${sa('revenue')}</th>
      <th style="${thStyle}" onclick="sortEmpBy('cost')">成本 ${sa('cost')}</th>
      <th style="${thStyle}" onclick="sortEmpBy('profit')">盈利金额 ${sa('profit')}</th>
      <th style="${thStyle}" onclick="sortEmpBy('profit_ratio')">收益比 ${sa('profit_ratio')}</th>
      <th>状态</th>
    </tr>`;

  const tbody = document.getElementById('empTableBody');
  tbody.innerHTML = rows.length ? rows.map((r, i) => `
    <tr>
      <td style="color:var(--gray-400);font-weight:600">${i+1}</td>
      <td style="font-weight:600">${r.name}</td>
      <td>${typeBadge(r.employee_type)}</td>
      <td><span style="color:var(--gray-500)">${r.project||'--'}</span></td>
      <td>¥${parseFloat(r.daily_rate).toLocaleString()}/天</td>
      <td>${parseFloat(r.dispatch_days).toFixed(2)} 天</td>
      <td>${fmt(r.revenue)}</td>
      <td>${fmt(r.cost)}</td>
      <td style="font-weight:700;color:${parseFloat(r.profit)>=0?'var(--success)':'var(--danger)'}">${fmt(r.profit)}</td>
      <td>${ratioBadge(r.profit_ratio)}</td>
      <td>${statusTag(r.status)}</td>
    </tr>`).join('')
    : '<tr><td colspan="11" style="text-align:center;padding:40px;color:var(--gray-500)">暂无数据，请先上传或录入数据</td></tr>';
}

function renderEmpBarChart(rows) {
  const ctx = document.getElementById('empBarChart').getContext('2d');
  if (empBarChart) empBarChart.destroy();
  if (!rows.length) return;
  const sorted = [...rows].sort((a,b) => parseFloat(b.profit)-parseFloat(a.profit));
  empBarChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: sorted.map(r=>r.name),
      datasets: [
        { label:'结算金额', data:sorted.map(r=>r.revenue), backgroundColor:'#bfdbfe' },
        { label:'盈利金额', data:sorted.map(r=>r.profit), backgroundColor:sorted.map(r=>parseFloat(r.profit)>=0?'#22c55e':'#ef4444') }
      ]
    },
    options: { plugins:{legend:{position:'bottom'}}, scales:{y:{ticks:{callback:v=>'¥'+(v/1000).toFixed(0)+'k'}}} }
  });
}

// ===== 手动录入 =====
function calcManualPreview() {
  const emp = employees.find(e => e.id == document.getElementById('manualEmployee').value);
  const days = parseFloat(document.getElementById('manualDays').value) || 0;
  const cost = parseFloat(document.getElementById('manualCost').value) || 0;
  if (!emp || !days) { document.getElementById('manualCalcResult').style.display = 'none'; return; }
  const manualRev = document.getElementById('manualRevenue').value;
  const revenue = manualRev !== '' ? parseFloat(manualRev) || 0 : days * parseFloat(emp.daily_rate);
  const profit = revenue - cost;
  const ratio = revenue > 0 ? profit / revenue : 0;
  document.getElementById('calcRevenue').textContent = fmt(revenue);
  document.getElementById('calcProfit').textContent = fmt(profit);
  document.getElementById('calcProfit').style.color = profit >= 0 ? 'var(--success)' : 'var(--danger)';
  document.getElementById('calcRatio').textContent = fmtRatio(ratio);
  document.getElementById('manualCalcResult').style.display = 'block';
}

async function submitManualEntry() {
  const year = document.getElementById('manualYear').value;
  const month = document.getElementById('manualMonth').value;
  const employee_id = document.getElementById('manualEmployee').value;
  const dispatch_days = document.getElementById('manualDays').value;
  const cost = document.getElementById('manualCost').value;
  const revenueInput = document.getElementById('manualRevenue').value;
  const revenue = revenueInput !== '' ? revenueInput : undefined;
  const status = document.getElementById('manualStatus').value;
  const notes = document.getElementById('manualNotes').value;
  const msg = document.getElementById('manualMsg');
  if (!employee_id || !dispatch_days) { msg.innerHTML = '<span style="color:var(--danger)">请选择员工并填写人天数</span>'; return; }
  try {
    await api('POST', '/finance/dispatch', { employee_id, year, month, dispatch_days, cost, revenue, status, notes });
    msg.innerHTML = '<span style="color:var(--success)">✓ 保存成功</span>';
    setTimeout(() => msg.innerHTML = '', 3000);
  } catch(e) { msg.innerHTML = '<span style="color:var(--danger)">保存失败</span>'; }
}

// ===== 财务模态框 =====
function openFinanceModal() { document.getElementById('financeModal').classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

async function saveFinance() {
  const { year, month } = getSelYearMonth();
  await api('POST', '/finance/monthly', {
    year, month,
    outsource_revenue: document.getElementById('fOutsource').value || 0,
    fixed_expense: document.getElementById('fFixed').value || 0,
    other_expense: document.getElementById('fOther').value || 0,
    notes: document.getElementById('fNotes').value
  });
  closeModal('financeModal');
  loadCurrentMonth();
}

// ===== 上传文件 =====
function handleFileSelect(input) { if (input.files[0]) uploadFile(input.files[0]); }

async function uploadFile(file) {
  const year = document.getElementById('uploadYear').value;
  const result = document.getElementById('uploadResult');
  result.style.display = 'block';
  result.innerHTML = '<div style="color:var(--gray-500);padding:12px">正在解析文件，导入全年数据...</div>';
  const fd = new FormData();
  fd.append('file', file);
  fd.append('year', year);
  try {
    const data = await apiUpload('/finance/upload-excel', fd);
    if (data.error) throw new Error(data.error);
    const monthNames = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
    const summaryRows = Object.entries(data.summary||{}).sort((a,b)=>parseInt(a[0])-parseInt(b[0]))
      .map(([m,count])=>`<span style="display:inline-block;margin:2px 6px;font-size:12px;color:var(--gray-600)">${monthNames[parseInt(m)-1]}：${count}条</span>`).join('');
    result.innerHTML = `
      <div class="success-msg" style="margin-bottom:12px">✓ 成功导入 ${data.imported} 条员工数据（${year}年全年）</div>
      <div style="padding:10px 12px;background:var(--gray-50);border-radius:6px;margin-bottom:12px">${summaryRows||'无数据'}</div>
      <table style="font-size:13px;width:100%;border-collapse:collapse">
        <thead><tr>
          <th style="text-align:left;padding:6px 10px;background:var(--gray-50)">月份</th>
          <th style="text-align:left;padding:6px 10px;background:var(--gray-50)">姓名</th>
          <th style="text-align:right;padding:6px 10px;background:var(--gray-50)">结算人天</th>
          <th style="text-align:right;padding:6px 10px;background:var(--gray-50)">结算金额</th>
          <th style="text-align:right;padding:6px 10px;background:var(--gray-50)">盈利</th>
          <th style="text-align:right;padding:6px 10px;background:var(--gray-50)">收益比</th>
        </tr></thead>
        <tbody>${data.data.map(r=>`
          <tr>
            <td style="padding:6px 10px;border-bottom:1px solid var(--gray-100);color:var(--gray-500)">${r.month}月</td>
            <td style="padding:6px 10px;border-bottom:1px solid var(--gray-100)">${r.name}</td>
            <td style="padding:6px 10px;text-align:right;border-bottom:1px solid var(--gray-100)">${r.dispatch_days}</td>
            <td style="padding:6px 10px;text-align:right;border-bottom:1px solid var(--gray-100)">${fmt(r.revenue)}</td>
            <td style="padding:6px 10px;text-align:right;border-bottom:1px solid var(--gray-100);color:${r.profit>=0?'var(--success)':'var(--danger)'}">${fmt(r.profit)}</td>
            <td style="padding:6px 10px;text-align:right;border-bottom:1px solid var(--gray-100)">${ratioBadge(r.profit_ratio)}</td>
          </tr>`).join('')}
        </tbody>
      </table>`;
    loadEmployees();
  } catch(err) { result.innerHTML = `<div class="error-msg">解析失败：${err.message}</div>`; }
}

// ===== 员工管理（内联编辑）=====
const EMP_COLS = [
  { key: 'name',            label: '姓名',     w: '10%', sortable: true  },
  { key: 'employee_type',   label: '类型',     w: '7%',  sortable: true  },
  { key: 'project',         label: '项目组',   w: '9%',  sortable: true  },
  { key: 'daily_rate',      label: '人天单价', w: '9%',  sortable: true  },
  { key: 'monthly_salary',  label: '月薪',     w: '9%',  sortable: true  },
  { key: 'housing_subsidy', label: '住宿/天',  w: '9%',  sortable: true  },
  { key: 'other',           label: '其他',     w: '9%',  sortable: false },
  { key: '_action',         label: '操作',     w: '8%',  sortable: false },
];

function renderEmpMgmtThead() {
  const sa = (k) => sortArrow(k, empMgmtSortKey, empMgmtSortDesc);
  const ths = EMP_COLS.map(c => {
    if (c.sortable) return `<th style="cursor:pointer;user-select:none;width:${c.w}" onclick="sortEmpMgmt('${c.key}')">${c.label} ${sa(c.key)}</th>`;
    return `<th style="width:${c.w}">${c.label}</th>`;
  }).join('');
  document.getElementById('empMgmtThead').innerHTML = `<tr>${ths}</tr>`;
}

function sortEmpMgmt(key) {
  if (empMgmtSortKey === key) empMgmtSortDesc = !empMgmtSortDesc;
  else { empMgmtSortKey = key; empMgmtSortDesc = false; }
  renderEmpMgmtRows(empMgmtCache.filter(e => !e.resigned_date && e.is_active !== false));
  renderEmpMgmtThead();
}

async function loadEmpMgmt() {
  const filter = document.getElementById('empListFilter')?.value || '';
  const all = await api('GET', '/employees');
  empMgmtCache = all;

  let active = all.filter(e => !e.resigned_date && e.is_active !== false);
  const resigned = all.filter(e => e.resigned_date || e.is_active === false);
  if (filter) active = active.filter(e => e.employee_type === filter);

  renderEmpMgmtThead();
  renderEmpMgmtRows(active);

  document.getElementById('empResignedBody').innerHTML = resigned.length ? resigned.map(e => `
    <tr style="color:var(--gray-400)">
      <td style="font-weight:600">${e.name}</td>
      <td>${typeBadge(e.employee_type)}</td>
      <td>${e.project||'--'}</td>
      <td>¥${parseFloat(e.daily_rate).toLocaleString()}/天</td>
      <td>${e.resigned_date ? e.resigned_date.slice(0,10) : '--'}</td>
      <td><button class="btn-secondary btn-sm" onclick="reinstateEmp(${e.id})">恢复在职</button></td>
    </tr>`).join('')
    : `<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--gray-400)">无离职员工</td></tr>`;
}

function renderEmpMgmtRows(active) {
  const sorted = [...active].sort((a, b) => {
    const av = (a[empMgmtSortKey] || '').toString();
    const bv = (b[empMgmtSortKey] || '').toString();
    const an = parseFloat(av), bn = parseFloat(bv);
    const cmp = isNaN(an) ? av.localeCompare(bv) : an - bn;
    return empMgmtSortDesc ? -cmp : cmp;
  });
  document.getElementById('empMgmtBody').innerHTML = sorted.map(e => empActiveRow(e)).join('')
    || `<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--gray-500)">暂无在职员工</td></tr>`;
}

function empActiveRow(e, editing = false) {
  if (!editing) {
    return `<tr id="emprow-${e.id}" ondblclick="editEmpRow(${e.id})" style="cursor:default">
      <td class="editable-cell" onclick="editEmpRow(${e.id})">${e.name}</td>
      <td class="editable-cell" onclick="editEmpRow(${e.id})">${typeBadge(e.employee_type)}</td>
      <td class="editable-cell" onclick="editEmpRow(${e.id})">${e.project||'--'}</td>
      <td class="editable-cell" onclick="editEmpRow(${e.id})">¥${parseFloat(e.daily_rate||0).toLocaleString()}/天</td>
      <td class="editable-cell" onclick="editEmpRow(${e.id})">${e.monthly_salary>0 ? fmt(e.monthly_salary) : '--'}</td>
      <td class="editable-cell" onclick="editEmpRow(${e.id})">${e.housing_subsidy>0 ? '¥'+parseFloat(e.housing_subsidy).toLocaleString()+'/天' : '--'}</td>
      <td class="editable-cell" onclick="editEmpRow(${e.id})">${e.other_info||'--'}</td>
      <td><button class="btn-danger btn-sm" onclick="openResignModal(${e.id},'${e.name.replace(/'/g,"\\'")}')">离职</button></td>
    </tr>`;
  }
  // 编辑行：onkeydown 处理 Enter/ESC
  const kd = `onkeydown="empRowKey(event,${e.id})"`;
  return `<tr id="emprow-${e.id}" style="background:#f0f7ff">
    <td><input class="inline-input" id="ei-name-${e.id}" value="${(e.name||'').replace(/"/g,'&quot;')}" ${kd}></td>
    <td><select class="inline-input" id="ei-type-${e.id}" ${kd}>
      <option value="外派" ${(e.employee_type||'外派')==='外派'?'selected':''}>外派</option>
      <option value="外包" ${e.employee_type==='外包'?'selected':''}>外包</option>
    </select></td>
    <td><input class="inline-input" id="ei-project-${e.id}" value="${(e.project||'').replace(/"/g,'&quot;')}" placeholder="项目组" ${kd}></td>
    <td><input class="inline-input" type="number" id="ei-rate-${e.id}" value="${e.daily_rate||''}" placeholder="人天单价" ${kd}></td>
    <td><input class="inline-input" type="number" id="ei-salary-${e.id}" value="${e.monthly_salary||''}" placeholder="月薪" ${kd}></td>
    <td><input class="inline-input" type="number" id="ei-housing-${e.id}" value="${e.housing_subsidy||''}" placeholder="住宿/天" ${kd}></td>
    <td><input class="inline-input" id="ei-other-${e.id}" value="${(e.other_info||'').replace(/"/g,'&quot;')}" placeholder="其他备注" ${kd}></td>
    <td style="white-space:nowrap">
      <button class="btn-primary btn-sm" onclick="saveEmpRow(${e.id})">保存</button>
      <button class="btn-secondary btn-sm" style="margin-left:4px" onclick="cancelEmpRow(${e.id})">取消</button>
    </td>
  </tr>`;
}

function empRowKey(event, id) {
  if (event.key === 'Enter') { event.preventDefault(); saveEmpRow(id); }
  if (event.key === 'Escape') { event.preventDefault(); cancelEmpRow(id); }
}

function editEmpRow(id) {
  const e = empMgmtCache.find(x => x.id == id);
  if (!e) { loadEmpMgmt(); return; }
  document.getElementById(`emprow-${id}`).outerHTML = empActiveRow(e, true);
  document.getElementById(`ei-name-${id}`).focus();
}

function cancelEmpRow(id) {
  const e = empMgmtCache.find(x => x.id == id);
  if (!e) { loadEmpMgmt(); return; }
  document.getElementById(`emprow-${id}`).outerHTML = empActiveRow(e, false);
}

async function saveEmpRow(id) {
  const body = {
    name: document.getElementById(`ei-name-${id}`).value,
    employee_type: document.getElementById(`ei-type-${id}`).value,
    project: document.getElementById(`ei-project-${id}`).value,
    daily_rate: document.getElementById(`ei-rate-${id}`).value,
    monthly_salary: document.getElementById(`ei-salary-${id}`).value,
    housing_subsidy: document.getElementById(`ei-housing-${id}`).value,
    other_info: document.getElementById(`ei-other-${id}`).value,
  };
  await api('PUT', `/employees/${id}`, body);
  loadEmpMgmt();
  loadEmployees();
}

function openEmpModal() {
  document.getElementById('empModalTitle').textContent = '新增员工';
  document.getElementById('empModalId').value = '';
  document.getElementById('empName').value = '';
  document.getElementById('empType').value = '外派';
  document.getElementById('empProject').value = '';
  document.getElementById('empRate').value = '';
  document.getElementById('empSalary').value = '';
  document.getElementById('empHousing').value = '';
  document.getElementById('empModal').classList.add('open');
}

async function saveEmployee() {
  const body = {
    name: document.getElementById('empName').value,
    employee_type: document.getElementById('empType').value,
    project: document.getElementById('empProject').value,
    daily_rate: document.getElementById('empRate').value,
    monthly_salary: document.getElementById('empSalary').value,
    housing_subsidy: document.getElementById('empHousing').value
  };
  await api('POST', '/employees', body);
  closeModal('empModal');
  loadEmpMgmt();
  loadEmployees();
}

function openResignModal(id, name) {
  document.getElementById('resignEmpId').value = id;
  document.getElementById('resignEmpName').textContent = `员工：${name}`;
  document.getElementById('resignDate').value = new Date().toISOString().slice(0,10);
  document.getElementById('resignModal').classList.add('open');
}

async function submitResign() {
  const id = document.getElementById('resignEmpId').value;
  const resigned_date = document.getElementById('resignDate').value;
  if (!resigned_date) { alert('请填写离职日期'); return; }
  await api('POST', `/employees/${id}/resign`, { resigned_date });
  closeModal('resignModal');
  loadEmpMgmt();
  loadEmployees();
}

async function reinstateEmp(id) {
  if (!confirm('确认恢复该员工为在职状态？')) return;
  await api('POST', `/employees/${id}/reinstate`, {});
  loadEmpMgmt();
  loadEmployees();
}

// ===== 数据管理 =====
function loadDataManage() {
  updateClearEmployeeSelect();
  updateClearPreview();
}

function updateClearPreview() {
  const year = document.getElementById('clearYear')?.value;
  const month = document.getElementById('clearMonth')?.value;
  const empSel = document.getElementById('clearEmployee');
  const empId = empSel?.value;
  const empName = empSel?.options[empSel.selectedIndex]?.text || '';
  const el = document.getElementById('clearPreviewText');
  if (!el || !year) return;
  let scope = `${year}年`;
  if (month) scope += `${month}月`;
  else scope += '全年（所有月份）';
  if (empId) scope += ` · ${empName}`;
  else scope += ' · 所有员工';
  el.innerHTML = `即将清除：<strong>${scope}</strong> 的外派结算数据${!empId?'及月度财务汇总':''}`;
}

async function confirmClear() {
  const year = document.getElementById('clearYear').value;
  const month = document.getElementById('clearMonth').value;
  const employee_id = document.getElementById('clearEmployee').value;
  const msg = document.getElementById('clearMsg');
  if (!year) { msg.innerHTML = '<span style="color:var(--danger)">请选择年份</span>'; return; }
  const empSel = document.getElementById('clearEmployee');
  const empName = empSel.options[empSel.selectedIndex]?.text || '所有员工';
  if (!confirm(`确认清除 ${year}年${month?month+'月':'全年'} · ${empName} 的数据？\n此操作不可撤销！`)) return;
  try {
    const body = { year };
    if (month) body.month = month;
    if (employee_id) body.employee_id = employee_id;
    const data = await api('DELETE', '/finance/clear', body);
    if (data.error) throw new Error(data.error);
    msg.innerHTML = `<span style="color:var(--success)">✓ 已清除 ${data.deleted_dispatch} 条外派记录，${data.deleted_finance} 条月度财务记录</span>`;
    setTimeout(() => msg.innerHTML = '', 5000);
  } catch(err) { msg.innerHTML = `<span style="color:var(--danger)">清除失败：${err.message}</span>`; }
}
