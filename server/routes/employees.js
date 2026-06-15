const router = require('express').Router();
const pool = require('../db');
const auth = require('../middleware/auth');

// 获取所有员工（含离职）
router.get('/', auth, async (req, res) => {
  const result = await pool.query(
    'SELECT * FROM employees ORDER BY resigned_date NULLS FIRST, project, name'
  );
  res.json(result.rows);
});

// 新增员工
router.post('/', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: '无权限' });
  const { name, project, employee_type, daily_rate, monthly_salary, housing_subsidy, other_info } = req.body;
  try {
    const r = await pool.query(
      'INSERT INTO employees (name, project, employee_type, daily_rate, monthly_salary, housing_subsidy, other_info) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [name, project, employee_type || '外派', daily_rate, monthly_salary || 0, housing_subsidy || 0, other_info || null]
    );
    res.json(r.rows[0]);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 更新员工
router.put('/:id', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: '无权限' });
  const { name, project, employee_type, daily_rate, monthly_salary, housing_subsidy, other_info } = req.body;
  const r = await pool.query(
    'UPDATE employees SET name=$1, project=$2, employee_type=$3, daily_rate=$4, monthly_salary=$5, housing_subsidy=$6, other_info=$7 WHERE id=$8 RETURNING *',
    [name, project, employee_type || '外派', daily_rate, monthly_salary, housing_subsidy, other_info || null, req.params.id]
  );
  res.json(r.rows[0]);
});

// 标记离职
router.post('/:id/resign', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: '无权限' });
  const { resigned_date } = req.body;
  if (!resigned_date) return res.status(400).json({ error: '请填写离职日期' });
  const r = await pool.query(
    'UPDATE employees SET resigned_date=$1, is_active=false WHERE id=$2 RETURNING *',
    [resigned_date, req.params.id]
  );
  res.json(r.rows[0]);
});

// 撤销离职（恢复在职）
router.post('/:id/reinstate', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: '无权限' });
  const r = await pool.query(
    'UPDATE employees SET resigned_date=NULL, is_active=true WHERE id=$1 RETURNING *',
    [req.params.id]
  );
  res.json(r.rows[0]);
});

module.exports = router;
