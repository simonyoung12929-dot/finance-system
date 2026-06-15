const router = require('express').Router();
const pool = require('../db');
const auth = require('../middleware/auth');

// 获取所有员工
router.get('/', auth, async (req, res) => {
  const result = await pool.query('SELECT * FROM employees WHERE is_active = true ORDER BY project, name');
  res.json(result.rows);
});

// 新增员工
router.post('/', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: '无权限' });
  const { name, project, employee_type, daily_rate, monthly_salary, housing_subsidy } = req.body;
  try {
    const r = await pool.query(
      'INSERT INTO employees (name, project, employee_type, daily_rate, monthly_salary, housing_subsidy) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [name, project, employee_type || '外派', daily_rate, monthly_salary || 0, housing_subsidy || 0]
    );
    res.json(r.rows[0]);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 更新员工
router.put('/:id', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: '无权限' });
  const { name, project, employee_type, daily_rate, monthly_salary, housing_subsidy } = req.body;
  const r = await pool.query(
    'UPDATE employees SET name=$1, project=$2, employee_type=$3, daily_rate=$4, monthly_salary=$5, housing_subsidy=$6 WHERE id=$7 RETURNING *',
    [name, project, employee_type || '外派', daily_rate, monthly_salary, housing_subsidy, req.params.id]
  );
  res.json(r.rows[0]);
});

// 停用员工
router.delete('/:id', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: '无权限' });
  await pool.query('UPDATE employees SET is_active = false WHERE id = $1', [req.params.id]);
  res.json({ message: '已停用' });
});

module.exports = router;
