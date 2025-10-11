// c:\Users\uehara\Desktop\kari\routes\index.js

const express = require('express');
const router = express.Router();

// 認証関連のルートを読み込む
router.use(require('./auth.js'));

// 駐車場関連のルートを読み込む
// ★★★ この行をコメントアウトする ★★★
// router.use(require('./parking.js')); 

module.exports = router;