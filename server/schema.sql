-- 用户表
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) DEFAULT 'viewer',  -- 'admin' 或 'viewer'
  created_at TIMESTAMP DEFAULT NOW()
);

-- 员工表
CREATE TABLE IF NOT EXISTS employees (
  id SERIAL PRIMARY KEY,
  name VARCHAR(50) NOT NULL,
  project VARCHAR(50),           -- 所属项目组（如L36、L22等）
  employee_type VARCHAR(10) DEFAULT '外派', -- 外派 / 外包
  daily_rate NUMERIC(10,2) NOT NULL,  -- 人天单价
  monthly_salary NUMERIC(10,2),       -- 月薪（成本基础）
  housing_subsidy NUMERIC(10,2) DEFAULT 0,  -- 房补（每天）
  is_active BOOLEAN DEFAULT true,
  resigned_date DATE DEFAULT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
-- 为旧表添加列（如已存在则忽略）
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employees' AND column_name='employee_type') THEN
    ALTER TABLE employees ADD COLUMN employee_type VARCHAR(10) DEFAULT '外派';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employees' AND column_name='resigned_date') THEN
    ALTER TABLE employees ADD COLUMN resigned_date DATE DEFAULT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employees' AND column_name='other_info') THEN
    ALTER TABLE employees ADD COLUMN other_info TEXT DEFAULT NULL;
  END IF;
END $$;

-- 月度外派记录（每位员工每月）
CREATE TABLE IF NOT EXISTS monthly_dispatch (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER REFERENCES employees(id),
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,          -- 1-12
  dispatch_days NUMERIC(8,2) DEFAULT 0,     -- 结算人天数
  adjusted_days NUMERIC(8,2) DEFAULT 0,     -- 扣除房补后人天（实际计费）
  revenue NUMERIC(12,2) DEFAULT 0,          -- 结算金额 = adjusted_days × daily_rate
  cost NUMERIC(12,2) DEFAULT 0,             -- 成本（工资+分摊）
  profit NUMERIC(12,2) DEFAULT 0,           -- 盈利金额 = revenue - cost
  profit_ratio NUMERIC(8,4) DEFAULT 0,      -- 收益比 = profit / revenue
  status VARCHAR(20) DEFAULT '未结算',       -- 已支付/已开票/已确认/未确认
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(employee_id, year, month)
);

-- 月度公司整体财务（收入+其他开支）
CREATE TABLE IF NOT EXISTS monthly_finance (
  id SERIAL PRIMARY KEY,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  total_revenue NUMERIC(12,2) DEFAULT 0,       -- 外派总收入
  outsource_revenue NUMERIC(12,2) DEFAULT 0,   -- 外包收入
  total_salary_cost NUMERIC(12,2) DEFAULT 0,   -- 工资总支出（汇总自员工表）
  fixed_expense NUMERIC(12,2) DEFAULT 0,       -- 固定开支（房租/水电等）
  other_expense NUMERIC(12,2) DEFAULT 0,       -- 其他变动支出
  total_profit NUMERIC(12,2) DEFAULT 0,        -- 净利润
  profit_rate NUMERIC(8,4) DEFAULT 0,          -- 利润率
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(year, month)
);

-- 外包项目表
CREATE TABLE IF NOT EXISTS outsource_projects (
  id SERIAL PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  person_days NUMERIC(8,2),
  amount NUMERIC(12,2),
  status VARCHAR(20),   -- 已结算/已开票/待开票/待流程
  year INTEGER,
  month INTEGER,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 默认管理员账号（密码在应用启动时设置）
-- 初始密码: admin123
