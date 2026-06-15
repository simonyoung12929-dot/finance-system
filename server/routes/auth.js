const router = require('express').Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'finance_secret_2025';

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: '用户名或密码错误' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: '用户名或密码错误' });

    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, username: user.username, role: user.role });
  } catch (err) {
    res.status(500).json({ error: '服务器错误' });
  }
});

// 仅管理员可创建用户
router.post('/register', require('../middleware/auth'), async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: '无权限' });
  const { username, password, role = 'viewer' } = req.body;
  try {
    const hash = await bcrypt.hash(password, 10);
    await pool.query('INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3)', [username, hash, role]);
    res.json({ message: '创建成功' });
  } catch (err) {
    res.status(400).json({ error: '用户名已存在' });
  }
});

module.exports = router;
