const express = require('express');
const cors = require('cors');
const path = require('path');
const pool = require('./db');
const bcrypt = require('bcrypt');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/employees', require('./routes/employees'));
app.use('/api/finance', require('./routes/finance'));

// 所有非API路由返回前端页面
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, '../public/index.html'));
  }
});

async function initDB() {
  try {
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await pool.query(schema);

    // 创建默认admin账号（如果不存在）
    const existing = await pool.query("SELECT id FROM users WHERE username = 'admin'");
    if (existing.rows.length === 0) {
      const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'admin123', 10);
      await pool.query("INSERT INTO users (username, password_hash, role) VALUES ('admin', $1, 'admin')", [hash]);
      console.log('默认管理员账号已创建 - 用户名: admin, 密码: admin123');
    }
  } catch (err) {
    console.error('数据库初始化失败:', err.message);
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  await initDB();
  console.log(`财务系统已启动: http://localhost:${PORT}`);
});
