const router = require('express').Router();
const pool = require('../db');
const auth = require('../middleware/auth');
const multer = require('multer');
const XLSX = require('xlsx');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// 获取某月汇总数据
router.get('/summary/:year/:month', auth, async (req, res) => {
  const { year, month } = req.params;
  try {
    const finance = await pool.query('SELECT * FROM monthly_finance WHERE year=$1 AND month=$2', [year, month]);
    const dispatch = await pool.query(`
      SELECT md.*, e.name, e.project, e.daily_rate
      FROM monthly_dispatch md
      JOIN employees e ON md.employee_id = e.id
      WHERE md.year=$1 AND md.month=$2
      ORDER BY md.profit_ratio DESC
    `, [year, month]);
    res.json({ finance: finance.rows[0] || null, employees: dispatch.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 获取历史趋势（近12个月）
router.get('/trend', auth, async (req, res) => {
  const result = await pool.query(`
    SELECT year, month, total_revenue, total_profit, profit_rate
    FROM monthly_finance
    ORDER BY year DESC, month DESC
    LIMIT 12
  `);
  res.json(result.rows.reverse());
});

// 获取员工历史收益比趋势
router.get('/employee-trend/:employeeId', auth, async (req, res) => {
  const result = await pool.query(`
    SELECT year, month, revenue, cost, profit, profit_ratio, dispatch_days
    FROM monthly_dispatch
    WHERE employee_id = $1
    ORDER BY year, month
    LIMIT 12
  `, [req.params.employeeId]);
  res.json(result.rows);
});

// 手动录入/更新月度整体财务
router.post('/monthly', auth, async (req, res) => {
  const { year, month, outsource_revenue, fixed_expense, other_expense, notes } = req.body;
  try {
    // 从员工数据汇总外派收入和成本
    const dispatchSummary = await pool.query(`
      SELECT COALESCE(SUM(revenue), 0) as total_rev, COALESCE(SUM(cost), 0) as total_cost
      FROM monthly_dispatch WHERE year=$1 AND month=$2
    `, [year, month]);

    const dispatch_revenue = parseFloat(dispatchSummary.rows[0].total_rev);
    const salary_cost = parseFloat(dispatchSummary.rows[0].total_cost);
    const total_revenue = dispatch_revenue + parseFloat(outsource_revenue || 0);
    const total_expenses = salary_cost + parseFloat(fixed_expense || 0) + parseFloat(other_expense || 0);
    const total_profit = total_revenue - total_expenses;
    const profit_rate = total_revenue > 0 ? total_profit / total_revenue : 0;

    const r = await pool.query(`
      INSERT INTO monthly_finance (year, month, total_revenue, outsource_revenue, total_salary_cost, fixed_expense, other_expense, total_profit, profit_rate, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (year, month) DO UPDATE SET
        total_revenue=$3, outsource_revenue=$4, total_salary_cost=$5,
        fixed_expense=$6, other_expense=$7, total_profit=$8, profit_rate=$9, notes=$10
      RETURNING *
    `, [year, month, total_revenue, outsource_revenue || 0, salary_cost, fixed_expense || 0, other_expense || 0, total_profit, profit_rate, notes]);

    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 录入/更新单个员工当月数据
router.post('/dispatch', auth, async (req, res) => {
  const { employee_id, year, month, dispatch_days, adjusted_days, cost, status, notes } = req.body;
  try {
    const emp = await pool.query('SELECT daily_rate FROM employees WHERE id=$1', [employee_id]);
    if (!emp.rows[0]) return res.status(404).json({ error: '员工不存在' });

    const daily_rate = parseFloat(emp.rows[0].daily_rate);
    const adj = parseFloat(adjusted_days || dispatch_days);
    const revenue = adj * daily_rate;
    const c = parseFloat(cost || 0);
    const profit = revenue - c;
    const profit_ratio = revenue > 0 ? profit / revenue : 0;

    const r = await pool.query(`
      INSERT INTO monthly_dispatch (employee_id, year, month, dispatch_days, adjusted_days, revenue, cost, profit, profit_ratio, status, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT (employee_id, year, month) DO UPDATE SET
        dispatch_days=$4, adjusted_days=$5, revenue=$6, cost=$7, profit=$8, profit_ratio=$9, status=$10, notes=$11
      RETURNING *
    `, [employee_id, year, month, dispatch_days, adj, revenue, c, profit, profit_ratio, status || '未结算', notes]);

    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 上传Excel文件解析员工数据（参考"3.21"表格格式）
// 支持全年批量导入：自动遍历所有12个月，跳过无数据的月份
router.post('/upload-excel', auth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请上传文件' });
  const { year } = req.body;
  if (!year) return res.status(400).json({ error: '请指定年份' });

  try {
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const totalImported = [];
    const errors = [];

    const targetSheet = wb.SheetNames.find(n => n.includes('3.21') || n.includes('结算')) || wb.SheetNames[0];
    const ws = wb.Sheets[targetSheet];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    // 遍历全年12个月
    for (let monthIdx = 0; monthIdx < 12; monthIdx++) {
      const month = monthIdx + 1;
      const colOffset = 2 + monthIdx * 5; // 每月5列: 人天,金额,成本,盈利,比例

      const monthResults = [];
      for (let i = 2; i < data.length; i++) {
        const row = data[i];
        const name = row[0]?.toString().trim();
        const daily_rate = parseFloat(row[1]) || 0;
        if (!name || !daily_rate) continue;

        const dispatch_days = parseFloat(row[colOffset]) || 0;
        if (dispatch_days === 0) continue;

        const revenue = parseFloat(row[colOffset + 1]) || 0;
        const cost = parseFloat(row[colOffset + 2]) || 0;
        const profit = parseFloat(row[colOffset + 3]) || 0;
        const profit_ratio = parseFloat(row[colOffset + 4]) || 0;

        // 查找或创建员工
        let empResult = await pool.query('SELECT id FROM employees WHERE name=$1', [name]);
        let emp_id;
        if (empResult.rows.length === 0) {
          const newEmp = await pool.query(
            'INSERT INTO employees (name, daily_rate) VALUES ($1,$2) RETURNING id',
            [name, daily_rate]
          );
          emp_id = newEmp.rows[0].id;
        } else {
          emp_id = empResult.rows[0].id;
          await pool.query('UPDATE employees SET daily_rate=$1 WHERE id=$2', [daily_rate, emp_id]);
        }

        await pool.query(`
          INSERT INTO monthly_dispatch (employee_id, year, month, dispatch_days, adjusted_days, revenue, cost, profit, profit_ratio)
          VALUES ($1,$2,$3,$4,$4,$5,$6,$7,$8)
          ON CONFLICT (employee_id, year, month) DO UPDATE SET
            dispatch_days=$4, adjusted_days=$4, revenue=$5, cost=$6, profit=$7, profit_ratio=$8
        `, [emp_id, year, month, dispatch_days, revenue, cost, profit, profit_ratio]);

        monthResults.push({ month, name, dispatch_days, revenue, cost, profit, profit_ratio });
      }

      totalImported.push(...monthResults);
    }

    // 按月汇总导入数量
    const summary = {};
    for (const r of totalImported) {
      summary[r.month] = (summary[r.month] || 0) + 1;
    }

    res.json({ imported: totalImported.length, summary, data: totalImported, errors });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 获取所有月份列表
router.get('/months', auth, async (req, res) => {
  const result = await pool.query('SELECT DISTINCT year, month FROM monthly_finance ORDER BY year DESC, month DESC');
  res.json(result.rows);
});

// 年报：汇总某年全部月份数据
router.get('/annual/:year', auth, async (req, res) => {
  const { year } = req.params;
  try {
    const finance = await pool.query(`
      SELECT
        COALESCE(SUM(total_revenue),0) as total_revenue,
        COALESCE(SUM(outsource_revenue),0) as outsource_revenue,
        COALESCE(SUM(total_salary_cost),0) as total_salary_cost,
        COALESCE(SUM(fixed_expense),0) as fixed_expense,
        COALESCE(SUM(other_expense),0) as other_expense,
        COALESCE(SUM(total_profit),0) as total_profit,
        COUNT(*) as months_count
      FROM monthly_finance WHERE year=$1
    `, [year]);

    const byMonth = await pool.query(`
      SELECT month, total_revenue, outsource_revenue, total_salary_cost, fixed_expense, other_expense, total_profit, profit_rate
      FROM monthly_finance WHERE year=$1 ORDER BY month
    `, [year]);

    const topEmployees = await pool.query(`
      SELECT e.name, e.employee_type,
        SUM(md.revenue) as total_revenue,
        SUM(md.profit) as total_profit,
        SUM(md.dispatch_days) as total_days,
        CASE WHEN SUM(md.revenue)>0 THEN SUM(md.profit)/SUM(md.revenue) ELSE 0 END as avg_ratio
      FROM monthly_dispatch md
      JOIN employees e ON md.employee_id = e.id
      WHERE md.year=$1
      GROUP BY e.id, e.name, e.employee_type
      ORDER BY total_profit DESC
      LIMIT 20
    `, [year]);

    const f = finance.rows[0];
    const total_revenue = parseFloat(f.total_revenue);
    const profit_rate = total_revenue > 0 ? parseFloat(f.total_profit) / total_revenue : 0;

    res.json({ year, summary: { ...f, profit_rate }, byMonth: byMonth.rows, topEmployees: topEmployees.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 清除数据
router.delete('/clear', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: '无权限' });
  const { year, month, employee_id } = req.body;
  if (!year) return res.status(400).json({ error: '请指定年份' });

  try {
    let dispatchQuery, dispatchParams;
    if (employee_id && month) {
      dispatchQuery = 'DELETE FROM monthly_dispatch WHERE year=$1 AND month=$2 AND employee_id=$3';
      dispatchParams = [year, month, employee_id];
    } else if (employee_id) {
      dispatchQuery = 'DELETE FROM monthly_dispatch WHERE year=$1 AND employee_id=$2';
      dispatchParams = [year, employee_id];
    } else if (month) {
      dispatchQuery = 'DELETE FROM monthly_dispatch WHERE year=$1 AND month=$2';
      dispatchParams = [year, month];
    } else {
      dispatchQuery = 'DELETE FROM monthly_dispatch WHERE year=$1';
      dispatchParams = [year];
    }

    const d = await pool.query(dispatchQuery, dispatchParams);

    let financeDeleted = 0;
    if (!employee_id) {
      const fQuery = month
        ? 'DELETE FROM monthly_finance WHERE year=$1 AND month=$2'
        : 'DELETE FROM monthly_finance WHERE year=$1';
      const fParams = month ? [year, month] : [year];
      const f = await pool.query(fQuery, fParams);
      financeDeleted = f.rowCount;
    }

    res.json({ deleted_dispatch: d.rowCount, deleted_finance: financeDeleted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
