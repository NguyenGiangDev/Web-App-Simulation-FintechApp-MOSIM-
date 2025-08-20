const path = require('path');
const dotenv = require('dotenv');


// Load NODE_ENV trước (từ .env mặc định)
dotenv.config({ path: path.join(__dirname, '..', '.env') });

// Chọn file env theo NODE_ENV
if (process.env.NODE_ENV === 'local') {
  dotenv.config({ path: path.join(__dirname, '..', '.env.local') });
  console.log("Loaded local env");
} else if (process.env.NODE_ENV === 'docker') {
  dotenv.config({ path: path.join(__dirname, '..', '.env.docker') });
  console.log("Loaded docker env");
} else {
  console.log("Loaded default .env");
}

const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'Public')));

// Lấy URL từ biến môi trường
const AUTH_SERVICE_URL = process.env['AUTHENTICATION-SERVICE']?.replace(';', '');
const CHARGE_SERVICE_URL = process.env['CHARGE-SERVICE']?.replace(';', '');
const HISTORY_SERVICE_URL = process.env['HISTORY-SERVICE']?.replace(';', '');
const TRANSACTION_SERVICE_URL = process.env['TRANSACTION-SERVICE']?.replace(';', '');

// Đăng ký
app.post('/register', async (req, res) => {
  const { fullname, phone, password, confirmPassword } = req.body;

  if (password !== confirmPassword) {
    return res.status(400).send('Mật khẩu không khớp');
  }

  try {
    await axios.post(`${AUTH_SERVICE_URL}/register`, {
      name: fullname,
      phone_number: phone,
      password
    });

    res.sendFile(path.join(__dirname, '..', 'Public', 'Login.html'));
  } catch (err) {
    if (err.response) {
      res.status(err.response.status).send(err.response.data.message || 'Lỗi từ auth_service');
    } else {
      res.status(500).send('API Gateway error');
    }
  }
});

// Đăng nhập
app.post('/login', async (req, res) => {
  const { phone_number, password } = req.body;

  try {
    const response = await axios.post(`${AUTH_SERVICE_URL}/login`, {
      phone_number,
      password
    });

    const { name, phone_number: phone } = response.data.user;
    res.redirect(`/Dashboard?name=${encodeURIComponent(name)}&phone=${encodeURIComponent(phone)}`);
  } catch (err) {
    if (err.response) {
      res.status(err.response.status).json({ message: err.response.data });
    } else if (err.request) {
      res.status(500).json({ message: 'Không thể kết nối tới auth-service' });
    } else {
      res.status(500).json({ message: 'Lỗi không xác định tại API Gateway' });
    }
  }
});

// Nạp tiền
app.post('/api/deposit', async (req, res) => {
  const { amount, username, phone_number } = req.body;

  try {
    const response = await axios.post(`${CHARGE_SERVICE_URL}/charge`, {
      amount,
      username,
      phone_number
    });

    const { balance } = response.data;
    res.json({ message: 'Nạp tiền thành công', balance });
  } catch (err) {
    console.error('Lỗi nạp tiền:', err.message);
    if (err.response) {
      res.status(err.response.status).json({ message: err.response.data });
    } else {
      res.status(500).json({ message: 'Không thể kết nối tới charge-service' });
    }
  }
});

// Lấy số dư
app.post('/api/get-balance', async (req, res) => {
  const { username, phone_number } = req.body;

  try {
    const response = await axios.post(`${CHARGE_SERVICE_URL}/get-balance`, {
      username,
      phone_number
    });

    res.json(response.data);
  } catch (err) {
    console.error('Lỗi từ charge-service:', err.message);
    res.status(500).json({ error: 'Không thể lấy số dư từ charge-service' });
  }
});

app.post('/api/add-history', async (req, res) => {
  const { amount, username, phone_number, bank, transaction_time } = req.body;
  try {
    const response = await axios.post(`${HISTORY_SERVICE_URL}/add-history`, {
      amount,
      username,
      phone_number,
      bank,
      transaction_time
    });
    res.json(response.data);
  } catch (err) {
    console.error('Lỗi từ history-service:', err.message);
    res.status(500).json({ error: 'Không thể lấy dữ liệu từ history-service' });
  }
});

// Lấy lịch sử tổng hợp
app.post('/api/get-combined-history', async (req, res) => {
  const { username, phone_number } = req.body;
  try {
    const [depositHistoryRes, transferHistoryRes] = await Promise.all([
      axios.post(`${HISTORY_SERVICE_URL}/history`, { username, phone_number }),
      axios.post(`${TRANSACTION_SERVICE_URL}/get-transaction-history`, { phone_number })
        .catch(e => ({ data: [] }))
    ]);

    const combinedHistory = [...depositHistoryRes.data, ...transferHistoryRes.data];
    combinedHistory.sort((a, b) => new Date(b.transaction_time) - new Date(a.transaction_time));
    res.json(combinedHistory);

  } catch (err) {
    console.error('Lỗi khi gộp lịch sử:', err.message);
    res.status(500).json({ error: 'Không thể lấy lịch sử tổng hợp' });
  }
});

app.post('/api/confirm-user', async (req, res) => {
  const { phone_number } = req.body;
  try {
    const response = await axios.post(`${AUTH_SERVICE_URL}/confirm-user`, {
      phone_number
    });
    res.json(response.data);
  }
  catch (err) {
    console.error('Lỗi từ auth-service:', err.message);
    res.status(500).json({ error: 'Không thể xác nhận người dùng từ auth-service' });
  }
});

app.post('/api/transfer', async (req, res) => {
  const { from_user, to_user, from_phone_number, to_phone_number, amount, transaction_realtime } = req.body;
  try {
    const response = await axios.post(`${TRANSACTION_SERVICE_URL}/transfer`, {
      from_user,
      to_user,
      from_phone_number,
      to_phone_number,
      amount,
      transaction_realtime
    });
    res.json(response.data);
  } catch (err) {
    console.error('Lỗi từ transfer-service', err.message);
    res.status(500).json({ error: 'Không thể thực hiện việc chuyển tiền !!' });
  }
});

// Route Dashboard
app.get('/Dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'Public', 'Dashboard.html'));
});

// Route gốc
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'Public', 'Wellcome_page.html'));
});

// Start server
app.listen(3000, () => {
  console.log('API Gateway listening on port 3000');
});