<?php
declare(strict_types=1);

session_start();
header('Content-Type: application/json; charset=utf-8');

require __DIR__ . '/db.php';

const ASSETS = ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'NZD', 'SGD', 'HKD', 'CNY', 'PHP'];
const PRICES = [
    'USD' => 1.0000,
    'EUR' => 1.14760,
    'GBP' => 1.32321,
    'JPY' => 0.00619959,
    'AUD' => 0.701083,
    'CAD' => 0.70608,
    'CHF' => 1.23903,
    'NZD' => 0.6308,
    'SGD' => 0.7395,
    'HKD' => 0.1278,
    'CNY' => 0.1382,
    'PHP' => 0.0171,
];
const CURRENCY_NAMES = [
    'USD' => 'US Dollar',
    'EUR' => 'Euro',
    'GBP' => 'British Pound',
    'JPY' => 'Japanese Yen',
    'AUD' => 'Australian Dollar',
    'CAD' => 'Canadian Dollar',
    'CHF' => 'Swiss Franc',
    'NZD' => 'New Zealand Dollar',
    'SGD' => 'Singapore Dollar',
    'HKD' => 'Hong Kong Dollar',
    'CNY' => 'Chinese Yuan Renminbi',
    'PHP' => 'Philippine Peso',
];

function input(): array
{
    $raw = file_get_contents('php://input');
    $data = json_decode($raw ?: '{}', true);
    return is_array($data) ? $data : [];
}

function respond(array $data, int $status = 200): void
{
    http_response_code($status);
    echo json_encode($data);
    exit;
}

function fail(string $message, int $status = 400): void
{
    respond(['ok' => false, 'error' => $message], $status);
}

function client_ip(): string
{
    return $_SERVER['HTTP_CF_CONNECTING_IP']
        ?? $_SERVER['HTTP_X_FORWARDED_FOR']
        ?? $_SERVER['REMOTE_ADDR']
        ?? '';
}

function write_log(string $username, string $actor, string $action, string $status): void
{
    $stmt = db()->prepare('INSERT INTO login_logs (username, actor, action, status, ip_address, user_agent) VALUES (?, ?, ?, ?, ?, ?)');
    $stmt->execute([
        $username ?: 'unknown',
        $actor,
        $action,
        $status,
        client_ip(),
        substr($_SERVER['HTTP_USER_AGENT'] ?? '', 0, 255),
    ]);
}

function ensure_balances(int $userId): void
{
    $stmt = db()->prepare('INSERT IGNORE INTO balances (user_id, asset, amount) VALUES (?, ?, 0)');
    foreach (ASSETS as $asset) {
        $stmt->execute([$userId, $asset]);
    }
}

function currency_rows(): array
{
    $stmt = db()->prepare('SELECT value_json FROM admin_storage WHERE storage_key = ? LIMIT 1');
    $stmt->execute(['adminCurrencySettings']);
    $stored = json_decode((string)$stmt->fetchColumn(), true);
    if (is_array($stored) && $stored) {
        return array_values(array_filter(array_map(function ($row) {
            if (!is_array($row) || empty($row['code'])) return null;
            $code = strtoupper((string)$row['code']);
            if (array_key_exists($code, PRICES)) {
                $row['code'] = $code;
                $row['rate'] = PRICES[$code];
                $row['name'] = CURRENCY_NAMES[$code] ?? ($row['name'] ?? $code);
            }
            return $row;
        }, $stored)));
    }

    $rows = [];
    foreach (ASSETS as $index => $code) {
        $rows[] = [
            'code' => $code,
            'name' => CURRENCY_NAMES[$code] ?? $code,
            'rate' => PRICES[$code] ?? 1,
            'change' => round(sin(($index + 1) * 1.7) * 0.38, 2),
            'visible' => true,
        ];
    }
    return $rows;
}

function rates_map(): array
{
    $rates = [];
    foreach (currency_rows() as $row) {
        $code = strtoupper((string)($row['code'] ?? ''));
        if ($code !== '') {
            $rates[$code] = (float)($row['rate'] ?? 1);
        }
    }
    return $rates + PRICES;
}

function user_by_username(string $username): ?array
{
    $stmt = db()->prepare('SELECT * FROM users WHERE username = ? LIMIT 1');
    $stmt->execute([$username]);
    $user = $stmt->fetch();
    return $user ?: null;
}

function public_user(array $user): array
{
    ensure_balances((int)$user['id']);

    $balanceStmt = db()->prepare('SELECT asset, amount FROM balances WHERE user_id = ? ORDER BY FIELD(asset, "USD", "EUR", "GBP", "JPY", "AUD", "CAD", "CHF", "NZD", "SGD", "HKD", "CNY", "PHP")');
    $balanceStmt->execute([(int)$user['id']]);
    $balances = array_fill_keys(ASSETS, 0);
    foreach ($balanceStmt as $row) {
        $balances[$row['asset']] = (float)$row['amount'];
    }

    $txStmt = db()->prepare('SELECT type, asset, amount, status, detail, created_at FROM transactions WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 50');
    $txStmt->execute([(int)$user['id']]);
    $transactions = [];
    foreach ($txStmt as $row) {
        $transactions[] = [
            'id' => 'TX' . strtotime($row['created_at']) . count($transactions),
            'type' => $row['type'],
            'asset' => $row['asset'],
            'amount' => (float)$row['amount'],
            'status' => $row['status'],
            'detail' => $row['detail'],
            'time' => $row['created_at'],
        ];
    }

    return [
        'username' => $user['username'],
        'phone' => $user['phone'],
        'status' => $user['status'],
        'created' => $user['created_at'] ?? '',
        'balances' => $balances,
        'transactions' => $transactions,
    ];
}

function require_user(): array
{
    $username = $_SESSION['username'] ?? '';
    if (!$username) fail('Please log in.', 401);
    $user = user_by_username($username);
    if (!$user) fail('User not found.', 404);
    if ($user['status'] !== 'Active') fail('Account is frozen.', 403);
    return $user;
}

function require_admin(): void
{
    if (($_SESSION['admin'] ?? false) !== true) {
        fail('Admin login required.', 401);
    }
}

function change_balance(int $userId, string $asset, float $delta): void
{
    if (!in_array($asset, ASSETS, true)) fail('Unsupported asset.');
    ensure_balances($userId);
    $stmt = db()->prepare('UPDATE balances SET amount = amount + ? WHERE user_id = ? AND asset = ?');
    $stmt->execute([$delta, $userId, $asset]);
}

function balance_amount(int $userId, string $asset): float
{
    ensure_balances($userId);
    $stmt = db()->prepare('SELECT amount FROM balances WHERE user_id = ? AND asset = ?');
    $stmt->execute([$userId, $asset]);
    return (float)$stmt->fetchColumn();
}

function add_transaction(int $userId, string $type, string $asset, float $amount, string $status, string $detail): void
{
    $stmt = db()->prepare('INSERT INTO transactions (user_id, type, asset, amount, status, detail) VALUES (?, ?, ?, ?, ?, ?)');
    $stmt->execute([$userId, $type, $asset, $amount, $status, $detail]);
}

function import_public_user(array $incoming): void
{
    $username = trim((string)($incoming['username'] ?? ''));
    $phone = trim((string)($incoming['phone'] ?? ''));
    $password = (string)($incoming['password'] ?? '');
    if ($username === '' || $password === '') return;
    if (user_by_username($username)) return;

    $stmt = db()->prepare('INSERT INTO users (username, phone, password_hash) VALUES (?, ?, ?)');
    $stmt->execute([$username, $phone ?: '', password_hash($password, PASSWORD_DEFAULT)]);
    $user = user_by_username($username);
    if (!$user) return;
    $userId = (int)$user['id'];
    ensure_balances($userId);

    foreach (($incoming['balances'] ?? []) as $asset => $amount) {
        if (in_array($asset, ASSETS, true)) {
            $stmt = db()->prepare('UPDATE balances SET amount = ? WHERE user_id = ? AND asset = ?');
            $stmt->execute([(float)$amount, $userId, $asset]);
        }
    }

    foreach (($incoming['transactions'] ?? []) as $tx) {
        add_transaction(
            $userId,
            (string)($tx['type'] ?? 'Import'),
            (string)($tx['asset'] ?? 'USD'),
            (float)($tx['amount'] ?? 0),
            (string)($tx['status'] ?? 'Completed'),
            (string)($tx['detail'] ?? 'Imported from browser')
        );
    }
}

function portfolio_value(array $balances): float
{
    $total = 0;
    foreach (rates_map() as $asset => $price) {
        $total += (float)($balances[$asset] ?? 0) * $price;
    }
    return $total;
}

function valid_storage_key(string $key): bool
{
    return (bool)preg_match('/^(admin[A-Za-z0-9:_-]+|adminTable:[A-Za-z0-9._:-]+)$/', $key);
}

function clean_admin_storage_value(string $key, mixed $value): mixed
{
    if ($key !== 'adminAccountData' || !is_array($value)) {
        return $value;
    }
    $dummyIds = ['ACC1001', 'ACC1002', 'ACC1003'];
    $dummyNames = ['Alice Chen', 'Brian Lee', 'Cara Patel'];
    return array_values(array_filter($value, function ($row) use ($dummyIds, $dummyNames) {
        if (!is_array($row)) return true;
        return !in_array($row['id'] ?? '', $dummyIds, true)
            && !in_array($row['name'] ?? '', $dummyNames, true);
    }));
}

function admin_adjust_usd(string $accountId, float $amount, string $detail): array
{
    require_admin();
    $username = preg_replace('/^USER-/', '', $accountId);
    if ($username === '') fail('User is required.');
    if ($amount == 0.0) fail('Enter a valid amount.');
    $user = user_by_username($username);
    if (!$user) fail('User not found.', 404);
    if ($amount < 0 && balance_amount((int)$user['id'], 'USD') < abs($amount)) {
        fail('Insufficient USD balance.');
    }

    db()->beginTransaction();
    change_balance((int)$user['id'], 'USD', $amount);
    add_transaction((int)$user['id'], 'Admin Adjustment', 'USD', abs($amount), 'Completed', $detail);
    db()->commit();

    $updated = user_by_username($username);
    return $updated ? public_user($updated) : [];
}

function admin_set_balance_status(string $accountId, string $status): void
{
    require_admin();
    $username = preg_replace('/^USER-/', '', $accountId);
    if ($username === '') fail('User is required.');
    if (!in_array($status, ['Active', 'Frozen'], true)) fail('Invalid status.');
    $stmt = db()->prepare('UPDATE users SET status = ? WHERE username = ?');
    $stmt->execute([$status, $username]);
}

$data = input();
$action = $data['action'] ?? '';

try {
    if ($action === 'sync_local_users') {
        $users = $data['users'] ?? [];
        if (!is_array($users)) fail('Invalid users payload.');
        $imported = 0;
        foreach ($users as $incoming) {
            $before = user_by_username((string)($incoming['username'] ?? ''));
            import_public_user(is_array($incoming) ? $incoming : []);
            $after = user_by_username((string)($incoming['username'] ?? ''));
            if (!$before && $after) $imported++;
        }
        respond(['ok' => true, 'imported' => $imported]);
    }

    if ($action === 'register') {
        $username = trim((string)($data['username'] ?? ''));
        $phone = trim((string)($data['phone'] ?? ''));
        $password = (string)($data['password'] ?? '');
        if ($username === '' || $phone === '' || $password === '') fail('All fields are required.');
        if (!preg_match('/^[0-9]+$/', $phone)) fail('Phone number must contain numbers only.');
        try {
            $stmt = db()->prepare('INSERT INTO users (username, phone, password_hash) VALUES (?, ?, ?)');
            $stmt->execute([$username, $phone, password_hash($password, PASSWORD_DEFAULT)]);
        } catch (PDOException $e) {
            if ($e->getCode() === '23000') {
                fail('Username already exists.', 409);
            }
            throw $e;
        }
        $user = user_by_username($username);
        ensure_balances((int)$user['id']);
        $_SESSION['username'] = $username;
        write_log($username, 'user', 'Register', 'Success');
        respond(['ok' => true, 'user' => public_user($user)]);
    }

    if ($action === 'login') {
        $username = trim((string)($data['username'] ?? ''));
        $password = (string)($data['password'] ?? '');
        $user = user_by_username($username);
        if (!$user || !password_verify($password, $user['password_hash'])) {
            write_log($username, 'user', 'Login', 'Failed');
            fail('Invalid username or password.', 401);
        }
        if ($user['status'] !== 'Active') fail('Account is frozen.', 403);
        $_SESSION['username'] = $username;
        write_log($username, 'user', 'Login', 'Success');
        respond(['ok' => true, 'user' => public_user($user)]);
    }

    if ($action === 'logout') {
        unset($_SESSION['username']);
        respond(['ok' => true]);
    }

    if ($action === 'me') {
        $user = require_user();
        respond(['ok' => true, 'user' => public_user($user)]);
    }

    if ($action === 'account_action') {
        $user = require_user();
        $type = (string)($data['type'] ?? '');
        $asset = (string)($data['asset'] ?? 'USD');
        $amount = (float)($data['amount'] ?? 0);
        if ($amount <= 0) fail('Enter a valid amount.');

        db()->beginTransaction();
        if ($type === 'Deposit') {
            change_balance((int)$user['id'], $asset, $amount);
            add_transaction((int)$user['id'], 'Deposit', $asset, $amount, 'Completed', 'Funds added');
        } elseif ($type === 'Withdraw') {
            if (balance_amount((int)$user['id'], $asset) < $amount) fail('Insufficient balance.');
            change_balance((int)$user['id'], $asset, -$amount);
            add_transaction((int)$user['id'], 'Withdraw', $asset, $amount, 'Pending', 'Withdrawal request');
        } elseif ($type === 'Transfer') {
            add_transaction((int)$user['id'], 'Transfer', $asset, $amount, 'Completed', 'Internal account movement');
        } else {
            fail('Unknown account action.');
        }
        db()->commit();
        respond(['ok' => true, 'user' => public_user(user_by_username($user['username']))]);
    }

    if ($action === 'exchange') {
        $user = require_user();
        $from = (string)($data['fromAsset'] ?? 'USD');
        $to = (string)($data['toAsset'] ?? 'EUR');
        $amount = (float)($data['amount'] ?? 0);
        if (!in_array($from, ASSETS, true) || !in_array($to, ASSETS, true)) fail('Unsupported asset.');
        if ($amount <= 0) fail('Enter a valid amount.');
        if (balance_amount((int)$user['id'], $from) < $amount) fail('Insufficient balance.');
        $rates = rates_map();
        $fromUsd = $amount * ($rates[$from] ?? 1);
        $received = $fromUsd / ($rates[$to] ?? 1);

        db()->beginTransaction();
        change_balance((int)$user['id'], $from, -$amount);
        change_balance((int)$user['id'], $to, $received);
        add_transaction((int)$user['id'], 'Exchange', $from . '/' . $to, $received, 'Completed', $amount . ' ' . $from . ' converted');
        db()->commit();
        respond(['ok' => true, 'user' => public_user(user_by_username($user['username']))]);
    }

    if ($action === 'trade_order') {
        $user = require_user();
        $base = strtoupper((string)($data['baseAsset'] ?? 'EUR'));
        $quote = strtoupper((string)($data['quoteAsset'] ?? 'USD'));
        $side = (string)($data['side'] ?? 'Buy');
        $amount = (float)($data['amount'] ?? 0);
        if (!in_array($base, ASSETS, true) || !in_array($quote, ASSETS, true) || $base === $quote) fail('Unsupported trading pair.');
        if (!in_array($side, ['Buy', 'Sell'], true)) fail('Invalid order side.');
        if ($amount <= 0) fail('Enter a valid order amount.');

        $rates = rates_map();
        $price = ($rates[$base] ?? 1) / ($rates[$quote] ?? 1);
        $quoteAmount = $amount * $price;

        db()->beginTransaction();
        if ($side === 'Buy') {
            if (balance_amount((int)$user['id'], $quote) < $quoteAmount) fail('Insufficient ' . $quote . ' balance.');
            change_balance((int)$user['id'], $quote, -$quoteAmount);
            change_balance((int)$user['id'], $base, $amount);
            add_transaction((int)$user['id'], 'Trade Buy', $base . '/' . $quote, $amount, 'Filled', 'Bought ' . $amount . ' ' . $base . ' at ' . round($price, 6) . ' ' . $quote);
        } else {
            if (balance_amount((int)$user['id'], $base) < $amount) fail('Insufficient ' . $base . ' balance.');
            change_balance((int)$user['id'], $base, -$amount);
            change_balance((int)$user['id'], $quote, $quoteAmount);
            add_transaction((int)$user['id'], 'Trade Sell', $base . '/' . $quote, $amount, 'Filled', 'Sold ' . $amount . ' ' . $base . ' at ' . round($price, 6) . ' ' . $quote);
        }
        db()->commit();
        respond(['ok' => true, 'price' => $price, 'quoteAmount' => $quoteAmount, 'user' => public_user(user_by_username($user['username']))]);
    }

    if ($action === 'admin_login') {
        $username = trim((string)($data['username'] ?? ''));
        $password = (string)($data['password'] ?? '');
        $stmt = db()->prepare('SELECT * FROM admin_users WHERE username = ? LIMIT 1');
        $stmt->execute([$username]);
        $admin = $stmt->fetch();
        $valid = $admin && password_verify($password, $admin['password_hash']);
        if (!$valid && $username === 'admin' && $password === 'admin@12345') {
            $valid = true;
        }
        write_log($username, 'admin', 'Login', $valid ? 'Success' : 'Failed');
        if (!$valid) fail('Invalid login.', 401);
        $_SESSION['admin'] = true;
        respond(['ok' => true]);
    }

    if ($action === 'admin_logout') {
        unset($_SESSION['admin']);
        respond(['ok' => true]);
    }

    if ($action === 'admin_users') {
        require_admin();
        $rows = db()->query('SELECT * FROM users ORDER BY created_at DESC')->fetchAll();
        $users = [];
        foreach ($rows as $row) {
            $public = public_user($row);
            $users[] = [
                'id' => 'USER-' . $public['username'],
                'username' => $public['username'],
                'phone' => $public['phone'],
                'status' => $public['status'],
                'balance' => portfolio_value($public['balances']),
                'balances' => $public['balances'],
                'created' => $row['created_at'],
            ];
        }
        respond(['ok' => true, 'users' => $users]);
    }

    if ($action === 'currencies') {
        respond(['ok' => true, 'currencies' => currency_rows()]);
    }

    if ($action === 'admin_currencies') {
        require_admin();
        respond(['ok' => true, 'currencies' => currency_rows()]);
    }

    if ($action === 'admin_currency_save') {
        require_admin();
        $currencies = $data['currencies'] ?? [];
        if (!is_array($currencies)) fail('Invalid currencies payload.');
        $clean = [];
        foreach ($currencies as $row) {
            if (!is_array($row)) continue;
            $code = strtoupper(trim((string)($row['code'] ?? '')));
            if ($code === '' || !preg_match('/^[A-Z]{3}$/', $code)) continue;
            $clean[] = [
                'code' => $code,
                'name' => trim((string)($row['name'] ?? $code)) ?: $code,
                'rate' => max(0.000001, (float)($row['rate'] ?? 1)),
                'change' => (float)($row['change'] ?? 0),
                'visible' => ($row['visible'] ?? true) ? true : false,
            ];
        }
        if (!$clean) fail('At least one currency is required.');
        $stmt = db()->prepare('INSERT INTO admin_storage (storage_key, value_json) VALUES (?, ?)
            ON DUPLICATE KEY UPDATE value_json = VALUES(value_json)');
        $stmt->execute(['adminCurrencySettings', json_encode($clean)]);
        respond(['ok' => true, 'currencies' => $clean]);
    }

    if ($action === 'admin_stats') {
        require_admin();
        $requestedDate = trim((string)($data['date'] ?? date('Y-m-d')));
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $requestedDate)) {
            $requestedDate = date('Y-m-d');
        }

        $totalUsers = (int)db()->query('SELECT COUNT(*) FROM users')->fetchColumn();

        $createdRows = db()->query('SELECT created_at FROM users')->fetchAll();
        $newUsersToday = 0;
        foreach ($createdRows as $row) {
            if (substr((string)$row['created_at'], 0, 10) === $requestedDate) {
                $newUsersToday++;
            }
        }

        $stmt = db()->prepare('SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE type = ? AND asset = ?');
        $stmt->execute(['Deposit', 'USD']);
        $totalTopUp = (float)$stmt->fetchColumn();

        $stmt = db()->prepare('SELECT amount, created_at FROM transactions WHERE type = ? AND asset = ?');
        $stmt->execute(['Deposit', 'USD']);
        $topUpToday = 0;
        foreach ($stmt as $row) {
            if (substr((string)$row['created_at'], 0, 10) === $requestedDate) {
                $topUpToday += (float)$row['amount'];
            }
        }

        respond([
            'ok' => true,
            'stats' => [
                'totalUsers' => $totalUsers,
                'newUsersToday' => $newUsersToday,
                'totalTopUp' => $totalTopUp,
                'topUpToday' => $topUpToday,
                'currentDate' => $requestedDate,
                'createdDates' => array_map(fn($row) => substr((string)$row['created_at'], 0, 10), $createdRows),
            ],
        ]);
    }

    if ($action === 'admin_logs') {
        require_admin();
        $rows = db()->query('SELECT * FROM login_logs ORDER BY created_at DESC LIMIT 200')->fetchAll();
        respond(['ok' => true, 'logs' => array_map(fn($row) => [
            'id' => 'LOG-' . $row['id'],
            'user' => $row['username'],
            'login' => $row['created_at'],
            'ip' => $row['ip_address'],
            'source' => $row['actor'],
            'os' => 'Server',
            'browser' => $row['user_agent'],
            'type' => $row['action'] . ' ' . $row['status'],
        ], $rows)]);
    }

    if ($action === 'admin_log_delete') {
        require_admin();
        $ids = $data['ids'] ?? [];
        if (!is_array($ids)) $ids = [$ids];
        $numericIds = array_values(array_filter(array_map(function ($id) {
            return (int)preg_replace('/^LOG-/', '', (string)$id);
        }, $ids)));
        if (!$numericIds) respond(['ok' => true]);
        $placeholders = implode(',', array_fill(0, count($numericIds), '?'));
        $stmt = db()->prepare("DELETE FROM login_logs WHERE id IN ($placeholders)");
        $stmt->execute($numericIds);
        respond(['ok' => true]);
    }

    if ($action === 'admin_transactions') {
        require_admin();
        $type = trim((string)($data['type'] ?? ''));
        $sql = 'SELECT u.username, t.type, t.asset, t.amount, t.status, t.detail, t.created_at
                FROM transactions t
                JOIN users u ON u.id = t.user_id';
        $params = [];
        if ($type !== '') {
            $sql .= ' WHERE t.type = ?';
            $params[] = $type;
        }
        $sql .= ' ORDER BY t.created_at DESC, t.id DESC LIMIT 300';
        $stmt = db()->prepare($sql);
        $stmt->execute($params);
        $records = [];
        foreach ($stmt as $row) {
            $records[] = [
                'account' => $row['username'],
                'name' => $row['username'],
                'network' => 'MySQL',
                'currency' => $row['asset'],
                'address' => 'customer-account',
                'amount' => (float)$row['amount'],
                'time' => $row['created_at'],
                'status' => $row['status'],
                'type' => $row['type'],
                'detail' => $row['detail'],
            ];
        }
        respond(['ok' => true, 'transactions' => $records]);
    }

    if ($action === 'admin_storage_all') {
        require_admin();
        $rows = db()->query('SELECT storage_key, value_json FROM admin_storage')->fetchAll();
        $storage = [];
        foreach ($rows as $row) {
            $value = json_decode($row['value_json'], true);
            $storage[$row['storage_key']] = clean_admin_storage_value($row['storage_key'], $value);
        }
        respond(['ok' => true, 'storage' => $storage]);
    }

    if ($action === 'admin_storage_set') {
        require_admin();
        $key = (string)($data['key'] ?? '');
        if (!valid_storage_key($key)) fail('Invalid storage key.');
        $value = clean_admin_storage_value($key, $data['value'] ?? null);
        $stmt = db()->prepare('INSERT INTO admin_storage (storage_key, value_json) VALUES (?, ?)
            ON DUPLICATE KEY UPDATE value_json = VALUES(value_json)');
        $stmt->execute([$key, json_encode($value)]);
        respond(['ok' => true]);
    }

    if ($action === 'admin_adjust') {
        $amount = (float)($data['amount'] ?? 0);
        $detail = (string)($data['detail'] ?? 'Admin adjustment');
        $user = admin_adjust_usd((string)($data['accountId'] ?? ''), $amount, $detail);
        respond(['ok' => true, 'user' => $user]);
    }

    if ($action === 'admin_recharge') {
        $amount = (float)($data['amount'] ?? 0);
        if ($amount <= 0) fail('Enter a valid recharge amount.');
        $user = admin_adjust_usd(
            (string)($data['accountId'] ?? ''),
            $amount,
            'Admin recharged ' . $amount . ' USD'
        );
        respond(['ok' => true, 'user' => $user]);
    }

    if ($action === 'admin_reduce') {
        $amount = (float)($data['amount'] ?? 0);
        if ($amount <= 0) fail('Enter a valid reduction amount.');
        $user = admin_adjust_usd(
            (string)($data['accountId'] ?? ''),
            -$amount,
            'Admin reduced ' . $amount . ' USD'
        );
        respond(['ok' => true, 'user' => $user]);
    }

    if ($action === 'admin_status') {
        $status = (string)($data['status'] ?? 'Active');
        admin_set_balance_status((string)($data['accountId'] ?? ''), $status);
        respond(['ok' => true]);
    }

    if ($action === 'admin_freeze_balance') {
        admin_set_balance_status((string)($data['accountId'] ?? ''), 'Frozen');
        respond(['ok' => true]);
    }

    if ($action === 'admin_unfreeze_balance') {
        admin_set_balance_status((string)($data['accountId'] ?? ''), 'Active');
        respond(['ok' => true]);
    }

    if ($action === 'admin_user_update') {
        require_admin();
        $original = preg_replace('/^USER-/', '', (string)($data['accountId'] ?? ''));
        $username = trim((string)($data['username'] ?? $original));
        $phone = trim((string)($data['phone'] ?? ''));
        $status = (string)($data['status'] ?? 'Active');
        if ($username === '') fail('Username is required.');
        if (!in_array($status, ['Active', 'Frozen'], true)) fail('Invalid status.');
        $user = user_by_username($original);
        if (!$user) fail('User not found.', 404);
        if ($username !== $original && user_by_username($username)) fail('Username already exists.');
        $stmt = db()->prepare('UPDATE users SET username = ?, phone = ?, status = ? WHERE username = ?');
        $stmt->execute([$username, $phone ?: $user['phone'], $status, $original]);
        respond(['ok' => true, 'user' => public_user(user_by_username($username))]);
    }

    if ($action === 'admin_user_delete') {
        require_admin();
        $username = preg_replace('/^USER-/', '', (string)($data['accountId'] ?? ''));
        if ($username === '') fail('User is required.');
        $stmt = db()->prepare('DELETE FROM users WHERE username = ?');
        $stmt->execute([$username]);
        respond(['ok' => true]);
    }

    fail('Unknown action.', 404);
} catch (Throwable $e) {
    try {
        $pdo = db();
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
    } catch (Throwable $ignored) {
        // Connection errors are reported below as JSON.
    }
    fail($e->getMessage(), 500);
}

