const API = '/api';
let token = localStorage.getItem('token');
let currentYear, currentMonth;
let employees = [];
let pieChart, trendChart, empBarChart;

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

  // 初始化年份选择
  const now = new Date();
  currentYear = now.getFullYear();
  currentMonth = now.getMonth() + 1;

  ['selYear', 'uploadYear', 'manualYear'].forEach(id => {
    const sel = document.getElementById(id);
    for (let y = now.getFullYear(); y >= 2023; y--) {
      sel.innerHTML += `<option value="${y}">${y}年</option>`;
    }
  });

  document.getElementById('selMonth').value = currentMonth;
  document.getElementById('manualMonth').value = currentMonth;

  // 侧边栏导航
  document.querySelectorAll('.nav-item[data-page]').forEach(item => {
    item.addEventListener('click', () => switchPage(item.dataset.page));
  });

  // 拖拽上传
  const zone = document.getElementById('uploadZone');
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('dragover');
    if (e.dataTransfer.files[0]) uploadFile(e.dataTransfer.files[0]);
  });

  // 员工选择联动
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

  loadEmployees();
  loadCurrentMonth();
})();

function logout() {
  localStorage.clear();
  window.location.href = '/';
}

function switchPage(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  document.querySelector(`[data-page="${page}"]`).classList.add('active');

  if (page === 'employees') loadEmpMgmt();
  if (page === 'employees-profit') loadEmployeeProfit();
}

// ===== API 请求 =====
async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(API + path, opts);
  if (res.status === 401) { localStorage.clear(); window.location.href = '/'; }
  return res.json();
}

async function apiUpload(path, formData) {
  const res = await fetch(API + path, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: formData
  });
  if (res.status === 401) { localStorage.clear(); window.location.href = '/'; }
  return res.json();
}

// ===== 格式化 =====
function fmt(n) {
  if (n === null || n === undefined || isNaN(n)) return '--';
  return '¥' + parseFloat(n).toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function fmtRatio(n) {
  if (n === null || n === undefined || isNaN(n)) return '--';
  return (parseFloat(n) * 100).toFixed(1) + '%';
}
function ratioBadge(r) {
  const pct = parseFloat(r) * 100;
  if (pct >= 35) return `<span class="ratio-badge ratio-high">${fmtRatio(r)}</span>`;
  if (pct >= 10) return `<span class="ratio-badge ratio-mid">${fmtRatio(r)}</span>`;
  return `<span class="ratio-badge ratio-low">${fmtRatio(r)}</span>`;
}
function statusTag(s) {
  const map = { '已支付': 'tag-paid', '已开票': 'tag-invoiced', '已确认': 'tag-invoiced', '未结算': 'tag-none' };
  return `<span class="tag ${map[s] || 'tag-pending'}">${s || '--'}</span>`;
}
function getSelYearMonth() {
  return {
    year: document.getElementById('selYear').value,
    month: document.getElementById('selMonth').value
  };
}

// ===== 加载员工列表 =====
async function loadEmployees() {
  try {
    employees = await api('GET', '/employees');
    const sel = document.getElementById('manualEmployee');
    sel.innerHTML = '<option value="">选择员工...</option>';
    employees.forEach(e => {
      sel.innerHTML += `<option value="${e.id}">${e.name}（¥${e.daily_rate}/天）</option>`;
    });
  } catch (e) { console.error(e); }
}

// ===== 加载当月数据 =====
async function loadCurrentMonth() {
  const { year, month } = getSelYearMonth();
  currentYear = year; currentMonth = month;
  const data = await api('GET', `/finance/summary/${year}/${month}`);
  renderDashboard(data, year, month);
  loadTrend();
}

function renderDashboard(data, year, month) {
  const label = `${year}年${month}月`;
  document.getElementById('dashboardSubtitle').textContent = label + ' 财务汇总';

  const f = data.finance;
  if (f) {
    const profit = parseFloat(f.total_profit);
    document.getElementById('totalProfit').textContent = fmt(f.total_profit);
    document.getElementById('totalProfit').className = 'value ' + (profit >= 0 ? '' : 'loss');
    document.getElementById('profitRate').textContent = '利润率 ' + fmtRatio(f.profit_rate);
    document.getElementById('totalRevenue').textContent = fmt(f.total_revenue);
    document.getElementById('revenueBreakdown').textContent = `外派 ${fmt(f.total_revenue - f.outsource_revenue)} + 外包 ${fmt(f.outsource_revenue)}`;
    document.getElementById('salaryCost').textContent = fmt(f.total_salary_cost);
    document.getElementById('otherExpense').textContent = fmt(parseFloat(f.fixed_expense) + parseFloat(f.other_expense));

    document.getElementById('financeDetail').innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;font-size:13px;">
        <div><span style="color:var(--gray-500)">外包收入：</span><strong>${fmt(f.outsource_revenue)}</strong></div>
        <div><span style="color:var(--gray-500)">固定开支：</span><strong>${fmt(f.fixed_expense)}</strong></div>
        <div><span style="color:var(--gray-500)">变动支出：</span><strong>${fmt(f.other_expense)}</strong></div>
        ${f.notes ? `<div style="grid-column:1/-1;color:var(--gray-500)">备注：${f.notes}</div>` : ''}
      </div>`;

    renderPieChart(f);
  } else {
    ['totalProfit','totalRevenue','salaryCost','otherExpense'].forEach(id => document.getElementById(id).textContent = '--');
  }

  if (data.employees?.length > 0 && document.getElementById('page-employees-profit').classList.contains('active')) {
    renderEmpTable(data.employees);
  }
}

// ===== 饼图 =====
function renderPieChart(f) {
  const ctx = document.getElementById('expensePieChart').getContext('2d');
  if (pieChart) pieChart.destroy();
  const salary = parseFloat(f.total_salary_cost) || 0;
  const fixed = parseFloat(f.fixed_expense) || 0;
  const other = parseFloat(f.other_expense) || 0;
  const profit = Math.max(0, parseFloat(f.total_profit) || 0);
  pieChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['员工工资', '固定开支', '其他支出', '利润'],
      datasets: [{ data: [salary, fixed, other, profit], backgroundColor: ['#3b82f6','#f59e0b','#ef4444','#22c55e'], borderWidth: 0 }]
    },
    options: { plugins: { legend: { position: 'bottom', labels: { font: { size: 12 } } } }, cutout: '60%' }
  });
}

// ===== 趋势图 =====
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
        { label: '总收入', data: trend.map(t => t.total_revenue), borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.1)', tension: 0.3, fill: true },
        { label: '净利润', data: trend.map(t => t.total_profit), borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,0.1)', tension: 0.3, fill: true }
      ]
    },
    options: {
      plugins: { legend: { position: 'bottom' } },
      scales: { y: { ticks: { callback: v => '¥' + (v/10000).toFixed(0) + 'w' } } }
    }
  });
}

// ===== 员工收益比 =====
async function loadEmployeeProfit() {
  const { year, month } = getSelYearMonth();
  const data = await api('GET', `/finance/summary/${year}/${month}`);
  document.getElementById('empTableTitle').textContent = `${year}年${month}月 员工收益明细`;
  renderEmpTable(data.employees || []);
  renderEmpBarChart(data.employees || []);
}

function renderEmpTable(rows) {
  const tbody = document.getElementById('empTableBody');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:40px;color:var(--gray-500)">暂无数据，请先上传或录入数据</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map((r, i) => `
    <tr>
      <td style="color:var(--gray-400);font-weight:600">${i + 1}</td>
      <td style="font-weight:600">${r.name}</td>
      <td><span style="color:var(--gray-500)">${r.project || '--'}</span></td>
      <td>¥${parseFloat(r.daily_rate).toLocaleString()}/天</td>
      <td>${parseFloat(r.dispatch_days).toFixed(2)} 天</td>
      <td>${fmt(r.revenue)}</td>
      <td>${fmt(r.cost)}</td>
      <td style="font-weight:700;color:${parseFloat(r.profit)>=0?'var(--success)':'var(--danger)'}">${fmt(r.profit)}</td>
      <td>${ratioBadge(r.profit_ratio)}</td>
      <td>${statusTag(r.status)}</td>
    </tr>
  `).join('');
}

function renderEmpBarChart(rows) {
  const ctx = document.getElementById('empBarChart').getContext('2d');
  if (empBarChart) empBarChart.destroy();
  if (!rows.length) return;
  const sorted = [...rows].sort((a, b) => parseFloat(b.profit) - parseFloat(a.profit));
  empBarChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: sorted.map(r => r.name),
      datasets: [
        { label: '结算金额', data: sorted.map(r => r.revenue), backgroundColor: '#bfdbfe' },
        { label: '盈利金额', data: sorted.map(r => r.profit), backgroundColor: sorted.map(r => parseFloat(r.profit) >= 0 ? '#22c55e' : '#ef4444') }
      ]
    },
    options: {
      plugins: { legend: { position: 'bottom' } },
      scales: { y: { ticks: { callback: v => '¥' + (v/1000).toFixed(0) + 'k' } } }
    }
  });
}

// ===== 手动录入 =====
function calcManualPreview() {
  const empId = document.getElementById('manualEmployee').value;
  const emp = employees.find(e => e.id == empId);
  const days = parseFloat(document.getElementById('manualDays').value) || 0;
  const cost = parseFloat(document.getElementById('manualCost').value) || 0;
  if (!emp || !days) { document.getElementById('manualCalcResult').style.display = 'none'; return; }

  const revenue = days * parseFloat(emp.daily_rate);
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
  const status = document.getElementById('manualStatus').value;
  const notes = document.getElementById('manualNotes').value;
  const msg = document.getElementById('manualMsg');

  if (!employee_id || !dispatch_days) { msg.innerHTML = '<span style="color:var(--danger)">请选择员工并填写人天数</span>'; return; }

  try {
    await api('POST', '/finance/dispatch', { employee_id, year, month, dispatch_days, cost, status, notes });
    msg.innerHTML = '<span style="color:var(--success)">✓ 保存成功</span>';
    setTimeout(() => msg.innerHTML = '', 3000);
  } catch (e) {
    msg.innerHTML = `<span style="color:var(--danger)">保存失败</span>`;
  }
}

// ===== 财务录入模态框 =====
function openFinanceModal() { document.getElementById('financeModal').classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

async function saveFinance() {
  const { year, month } = getSelYearMonth();
  const body = {
    year, month,
    outsource_revenue: document.getElementById('fOutsource').value || 0,
    fixed_expense: document.getElementById('fFixed').value || 0,
    other_expense: document.getElementById('fOther').value || 0,
    notes: document.getElementById('fNotes').value
  };
  await api('POST', '/finance/monthly', body);
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
    const summaryRows = Object.entries(data.summary || {})
      .sort((a,b) => parseInt(a[0]) - parseInt(b[0]))
      .map(([m, count]) => `<span style="display:inline-block;margin:2px 6px;font-size:12px;color:var(--gray-600)">${monthNames[parseInt(m)-1]}：${count}条</span>`)
      .join('');

    result.innerHTML = `
      <div class="success-msg" style="margin-bottom:12px">✓ 成功导入 ${data.imported} 条员工数据（${year}年全年）</div>
      <div style="padding:10px 12px;background:var(--gray-50);border-radius:6px;margin-bottom:12px">${summaryRows || '无数据'}</div>
      <table style="font-size:13px;width:100%;border-collapse:collapse">
        <thead><tr>
          <th style="text-align:left;padding:6px 10px;background:var(--gray-50)">月份</th>
          <th style="text-align:left;padding:6px 10px;background:var(--gray-50)">姓名</th>
          <th style="text-align:right;padding:6px 10px;background:var(--gray-50)">结算人天</th>
          <th style="text-align:right;padding:6px 10px;background:var(--gray-50)">结算金额</th>
          <th style="text-align:right;padding:6px 10px;background:var(--gray-50)">盈利</th>
          <th style="text-align:right;padding:6px 10px;background:var(--gray-50)">收益比</th>
        </tr></thead>
        <tbody>
          ${data.data.map(r => `
            <tr>
              <td style="padding:6px 10px;border-bottom:1px solid var(--gray-100);color:var(--gray-500)">${r.month}月</td>
              <td style="padding:6px 10px;border-bottom:1px solid var(--gray-100)">${r.name}</td>
              <td style="padding:6px 10px;text-align:right;border-bottom:1px solid var(--gray-100)">${r.dispatch_days}</td>
              <td style="padding:6px 10px;text-align:right;border-bottom:1px solid var(--gray-100)">${fmt(r.revenue)}</td>
              <td style="padding:6px 10px;text-align:right;border-bottom:1px solid var(--gray-100);color:${r.profit>=0?'var(--success)':'var(--danger)'}">${fmt(r.profit)}</td>
              <td style="padding:6px 10px;text-align:right;border-bottom:1px solid var(--gray-100)">${ratioBadge(r.profit_ratio)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>`;
    loadEmployees();
  } catch (err) {
    result.innerHTML = `<div class="error-msg">解析失败：${err.message}</div>`;
  }
}

// ===== 员工管理 =====
async function loadEmpMgmt() {
  const rows = await api('GET', '/employees');
  document.getElementById('empMgmtBody').innerHTML = rows.map(e => `
    <tr>
      <td style="font-weight:600">${e.name}</td>
      <td>${e.project || '--'}</td>
      <td>¥${parseFloat(e.daily_rate).toLocaleString()}/天</td>
      <td>${e.monthly_salary ? fmt(e.monthly_salary) : '--'}</td>
      <td>${e.housing_subsidy > 0 ? '¥' + e.housing_subsidy + '/天' : '--'}</td>
      <td>
        <button class="btn-secondary btn-sm" onclick="openEmpModal(${JSON.stringify(e).replace(/"/g,'&quot;')})">编辑</button>
        <button class="btn-danger btn-sm" style="margin-left:6px" onclick="deactivateEmp(${e.id})">停用</button>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--gray-500)">暂无员工</td></tr>';
}

function openEmpModal(emp) {
  document.getElementById('empModalTitle').textContent = emp ? '编辑员工' : '新增员工';
  document.getElementById('empModalId').value = emp?.id || '';
  document.getElementById('empName').value = emp?.name || '';
  document.getElementById('empProject').value = emp?.project || '';
  document.getElementById('empRate').value = emp?.daily_rate || '';
  document.getElementById('empSalary').value = emp?.monthly_salary || '';
  document.getElementById('empHousing').value = emp?.housing_subsidy || '';
  document.getElementById('empModal').classList.add('open');
}

async function saveEmployee() {
  const id = document.getElementById('empModalId').value;
  const body = {
    name: document.getElementById('empName').value,
    project: document.getElementById('empProject').value,
    daily_rate: document.getElementById('empRate').value,
    monthly_salary: document.getElementById('empSalary').value,
    housing_subsidy: document.getElementById('empHousing').value
  };
  if (id) await api('PUT', `/employees/${id}`, body);
  else await api('POST', '/employees', body);
  closeModal('empModal');
  loadEmpMgmt();
  loadEmployees();
}

async function deactivateEmp(id) {
  if (!confirm('确认停用该员工吗？')) return;
  await api('DELETE', `/employees/${id}`);
  loadEmpMgmt();
}
