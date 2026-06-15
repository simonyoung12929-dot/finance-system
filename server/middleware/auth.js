const jwt = require('jsonwebtoken');

module.exports = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: '未登录' });

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET || 'finance_secret_2025');
    next();
  } catch {
    res.status(401).json({ error: 'Token无效或已过期' });
  }
};
