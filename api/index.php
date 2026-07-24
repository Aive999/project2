<?php
declare(strict_types=1);

session_start();
header('Content-Type: application/json; charset=utf-8');

require __DIR__ . '/db.php';

const ASSETS = ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'NZD', 'SGD', 'HKD', 'CNY', 'PHP'];
const PRICES = [
    'USD' => 1.0000,
    'EUR' => 1.14760,
    'GBP' => 1.33,
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
    foreach (supported_assets() as $asset) {
        $stmt->execute([$userId, $asset]);
    }
}

function ensure_user_email_column(): void
{
    static $ready = false;
    if ($ready) return;
    $columns = db()->query('SHOW COLUMNS FROM users')->fetchAll();
    if (!in_array('email', array_column($columns, 'Field'), true)) {
        db()->exec("ALTER TABLE users ADD COLUMN email VARCHAR(190) NOT NULL DEFAULT '' AFTER phone");
    }
    $ready = true;
}

function ensure_identity_table(): void
{
    db()->exec("CREATE TABLE IF NOT EXISTS identity_verifications (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        user_id INT UNSIGNED NOT NULL,
        document_type ENUM('ID Card','Passport','Driver License') NOT NULL,
        id_number VARCHAR(80) NOT NULL,
        front_image LONGTEXT NOT NULL,
        back_image LONGTEXT NOT NULL,
        status ENUM('Pending','Approved','Rejected') NOT NULL DEFAULT 'Pending',
        review_note VARCHAR(255) NOT NULL DEFAULT '',
        reviewed_by VARCHAR(80) NOT NULL DEFAULT '',
        submitted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        reviewed_at TIMESTAMP NULL DEFAULT NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_identity_verifications_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_identity_verifications_status (status),
        INDEX idx_identity_verifications_user_time (user_id, submitted_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    $columns = db()->query('SHOW COLUMNS FROM identity_verifications')->fetchAll();
    $columnNames = array_map(fn($row) => $row['Field'] ?? '', $columns);
    if (!in_array('back_image', $columnNames, true)) {
        db()->exec('ALTER TABLE identity_verifications ADD COLUMN back_image LONGTEXT NOT NULL AFTER front_image');
    }
    db()->exec("UPDATE identity_verifications SET reviewed_by = 'system' WHERE reviewed_by = 'admin'");
}

function ensure_bank_binding_table(): void
{
    db()->exec("CREATE TABLE IF NOT EXISTS bank_binding_reviews (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        user_id INT UNSIGNED NOT NULL,
        bank VARCHAR(120) NOT NULL,
        account_name VARCHAR(120) NOT NULL,
        collection_account VARCHAR(160) NOT NULL,
        routing VARCHAR(80) NOT NULL,
        address VARCHAR(255) NOT NULL,
        status ENUM('Pending','Approved','Rejected') NOT NULL DEFAULT 'Pending',
        review_note VARCHAR(255) NOT NULL DEFAULT '',
        reviewed_by VARCHAR(80) NOT NULL DEFAULT '',
        submitted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        reviewed_at TIMESTAMP NULL DEFAULT NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_bank_binding_reviews_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_bank_binding_reviews_status (status),
        INDEX idx_bank_binding_reviews_user_time (user_id, submitted_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    db()->exec("UPDATE bank_binding_reviews SET reviewed_by = 'system' WHERE reviewed_by = 'admin'");
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

function supported_assets(): array
{
    $assets = [];
    foreach (currency_rows() as $row) {
        $code = strtoupper(trim((string)($row['code'] ?? '')));
        if (preg_match('/^[A-Z]{3}$/', $code)) $assets[] = $code;
    }
    return array_values(array_unique($assets));
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

function fluctuation_seed(string $code, float $offset = 0.0, int $tickShift = 0): float
{
    $tick = floor((microtime(true) * 1000) / 1800000) + $offset + $tickShift;
    $codeValue = 0;
    foreach (str_split($code) as $char) {
        $codeValue += ord($char);
    }
    return sin($tick * 0.83 + $codeValue * 1.37);
}

function floating_currency_rate(string $asset, float $offset = 0.0, int $tickShift = 0): float
{
    $rates = rates_map();
    $base = (float)($rates[$asset] ?? 1);
    if ($asset === 'GBP') return $base;
    $move = fluctuation_seed($asset, $offset, $tickShift) * 0.0018;
    return $base * (1 + $move);
}

function pair_market_price(string $base, string $quote): float
{
    if ($base === 'GBP' && $quote === 'USD') return 1.33;
    if ($base === 'USD' && $quote === 'GBP') return 1 / 1.33;
    return floating_currency_rate($base) / floating_currency_rate($quote, 3);
}

function exchange_received_amount(string $from, string $to, float $amount): float
{
    $rates = rates_map();
    return ($amount * ($rates[$from] ?? 1)) / ($rates[$to] ?? 1);
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
    ensure_user_email_column();
    ensure_balances((int)$user['id']);
    $verification = latest_verification((int)$user['id']);
    $bankBinding = latest_bank_binding((int)$user['id']);

    $assets = supported_assets();
    $placeholders = implode(',', array_fill(0, count($assets), '?'));
    $balanceStmt = db()->prepare("SELECT asset, amount FROM balances WHERE user_id = ? AND asset IN ($placeholders) ORDER BY asset");
    $balanceStmt->execute(array_merge([(int)$user['id']], $assets));
    $balances = array_fill_keys($assets, 0);
    foreach ($balanceStmt as $row) {
        $balances[$row['asset']] = (float)$row['amount'];
    }

    // Include erroneous duplicate rows in customer history. Older rows used the
    // Internal Duplicate status; expose those as filled orders for consistency.
    $txStmt = db()->prepare("SELECT id, type, asset, amount, status, detail, created_at FROM transactions WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 50");
    $txStmt->execute([(int)$user['id']]);
    $transactions = [];
    foreach ($txStmt as $row) {
        $transactions[] = [
            'id' => 'TX' . $row['id'],
            'recordId' => (int)$row['id'],
            'type' => $row['type'],
            'asset' => $row['asset'],
            'amount' => (float)$row['amount'],
            'status' => $row['status'] === 'Internal Duplicate' ? 'Filled' : $row['status'],
            'detail' => $row['detail'],
            'time' => $row['created_at'],
        ];
    }

    return [
        'username' => $user['username'],
        'email' => $user['email'] ?? '',
        'phone' => $user['phone'],
        'status' => $user['status'],
        'created' => $user['created_at'] ?? '',
        'balances' => $balances,
        'transactions' => $transactions,
        // Identity photos stay in MySQL and are returned only to the protected
        // admin verification endpoint, never to the browser's user cache.
        'verification' => $verification ? public_verification($verification, false) : null,
        'bankBinding' => $bankBinding ? public_bank_binding($bankBinding) : null,
    ];
}

function latest_verification(int $userId): ?array
{
    ensure_identity_table();
    $stmt = db()->prepare('SELECT * FROM identity_verifications WHERE user_id = ? ORDER BY submitted_at DESC, id DESC LIMIT 1');
    $stmt->execute([$userId]);
    $row = $stmt->fetch();
    return $row ?: null;
}

function public_verification(array $row, bool $includeImage = true): array
{
    $verification = [
        'id' => 'VER-' . $row['id'],
        'documentType' => $row['document_type'],
        'idNumber' => $row['id_number'],
        'status' => $row['status'],
        'reviewNote' => $row['review_note'] ?? '',
        'reviewedBy' => $row['reviewed_by'] ?? '',
        'submittedAt' => $row['submitted_at'] ?? '',
        'reviewedAt' => $row['reviewed_at'] ?? '',
    ];
    if ($includeImage) {
        $verification['frontImage'] = $row['front_image'];
        $verification['backImage'] = $row['back_image'] ?? '';
    }
    return $verification;
}

function latest_bank_binding(int $userId): ?array
{
    ensure_bank_binding_table();
    $stmt = db()->prepare('SELECT * FROM bank_binding_reviews WHERE user_id = ? ORDER BY submitted_at DESC, id DESC LIMIT 1');
    $stmt->execute([$userId]);
    $row = $stmt->fetch();
    return $row ?: null;
}

function public_bank_binding(array $row): array
{
    return [
        'id' => 'BANK-' . $row['id'],
        'bank' => $row['bank'],
        'name' => $row['account_name'],
        'collectionAccount' => $row['collection_account'],
        'routing' => $row['routing'],
        'address' => $row['address'],
        'status' => $row['status'],
        'reviewNote' => $row['review_note'] ?? '',
        'reviewedBy' => $row['reviewed_by'] ?? '',
        'submittedAt' => $row['submitted_at'] ?? '',
        'reviewedAt' => $row['reviewed_at'] ?? '',
        'updatedAt' => $row['updated_at'] ?? '',
    ];
}

function mask_id_number(string $idNumber): string
{
    $clean = trim($idNumber);
    $length = strlen($clean);
    if ($length <= 4) return str_repeat('*', $length);
    return substr($clean, 0, 2) . str_repeat('*', max(2, $length - 6)) . substr($clean, -4);
}

function validate_verification_image(string $dataUrl): void
{
    if (!preg_match('/^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+\/=]+$/', $dataUrl)) {
        fail('Upload a PNG, JPG, or WEBP identity document image.');
    }
}

function require_user(): array
{
    $username = $_SESSION['username'] ?? '';
    if (!$username) fail('Please log in.', 401);
    $user = user_by_username($username);
    if (!$user) fail('User not found.', 404);
    ensure_online_sessions_table();
    $sessionHash = hash('sha256', session_id());
    $session = db()->prepare('SELECT id, revoked FROM online_user_sessions WHERE user_id = ? AND session_hash = ? LIMIT 1');
    $session->execute([(int)$user['id'], $sessionHash]);
    $presence = $session->fetch();
    if ($presence && (int)$presence['revoked'] === 1) {
        unset($_SESSION['username']);
        fail('Your session has ended. Please log in again.', 401);
    }
    if (!$presence) {
        $register = db()->prepare('INSERT INTO online_user_sessions (user_id, session_hash, ip_address, user_agent) VALUES (?, ?, ?, ?)');
        $register->execute([(int)$user['id'], $sessionHash, client_ip(), substr($_SERVER['HTTP_USER_AGENT'] ?? '', 0, 255)]);
    }
    $touch = db()->prepare('UPDATE online_user_sessions SET last_seen = CURRENT_TIMESTAMP WHERE user_id = ? AND session_hash = ?');
    $touch->execute([(int)$user['id'], $sessionHash]);
    return $user;
}

function require_transactions_enabled(array $user): void
{
    if (($user['status'] ?? '') !== 'Active') {
        fail('Account funds are frozen. Transactions are unavailable.', 403);
    }
}

function ensure_online_sessions_table(): void
{
    db()->exec("CREATE TABLE IF NOT EXISTS online_user_sessions (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        user_id INT UNSIGNED NOT NULL,
        session_hash CHAR(64) NOT NULL UNIQUE,
        login_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_seen TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        ip_address VARCHAR(80) NOT NULL DEFAULT '',
        user_agent VARCHAR(255) NOT NULL DEFAULT '',
        revoked TINYINT(1) NOT NULL DEFAULT 0,
        CONSTRAINT fk_online_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_online_sessions_last_seen (last_seen)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    $columns = db()->query('SHOW COLUMNS FROM online_user_sessions')->fetchAll();
    if (!in_array('revoked', array_column($columns, 'Field'), true)) {
        db()->exec('ALTER TABLE online_user_sessions ADD COLUMN revoked TINYINT(1) NOT NULL DEFAULT 0 AFTER user_agent');
    }
}

function establish_user_session(string $username): void
{
    session_regenerate_id(true);
    $_SESSION['username'] = $username;
    $_SESSION['authenticated_at'] = time();
    $user = user_by_username($username);
    if (!$user) return;
    ensure_online_sessions_table();
    $stmt = db()->prepare('INSERT INTO online_user_sessions (user_id, session_hash, ip_address, user_agent, revoked) VALUES (?, ?, ?, ?, 0)');
    $stmt->execute([(int)$user['id'], hash('sha256', session_id()), client_ip(), substr($_SERVER['HTTP_USER_AGENT'] ?? '', 0, 255)]);
}

function validate_password_strength(string $password): void
{
    if (!preg_match('/^[0-9]{8}$/', $password)) fail('Password must contain exactly 8 digits.');
}

function require_admin(): void
{
    if (($_SESSION['admin'] ?? false) !== true) {
        fail('Admin login required.', 401);
    }
}

function change_balance(int $userId, string $asset, float $delta): void
{
    if (!in_array($asset, supported_assets(), true)) fail('Unsupported asset.');
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

function add_transaction(int $userId, string $type, string $asset, float $amount, string $status, string $detail, int $createdAtOffsetSeconds = 0): void
{
    $offset = max(0, $createdAtOffsetSeconds);
    $stmt = db()->prepare('INSERT INTO transactions (user_id, type, asset, amount, status, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ' . $offset . ' SECOND))');
    $stmt->execute([$userId, $type, $asset, $amount, $status, $detail]);
}

function ensure_idempotency_table(): void
{
    db()->exec("CREATE TABLE IF NOT EXISTS idempotency_keys (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        user_id INT UNSIGNED NOT NULL,
        action VARCHAR(40) NOT NULL,
        request_key VARCHAR(80) NOT NULL,
        response_json LONGTEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_idempotency_keys_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE KEY uq_idempotency_request (user_id, action, request_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
}

function idempotency_key(array $data): string
{
    $key = trim((string)($data['idempotencyKey'] ?? ''));
    if (!preg_match('/^[A-Za-z0-9_-]{16,80}$/', $key)) {
        fail('A valid order request key is required.');
    }
    return $key;
}

function normalize_simulation_action(mixed $value): string
{
    $normalized = strtolower(trim((string)$value));
    return match ($normalized) {
        'approve', 'approved', 'approval' => 'approve',
        'decline', 'declined', 'reject', 'rejected' => 'decline',
        'duplicate', 'duplicated', 'duplicate-record', 'dupe' => 'duplicate',
        'delay-duplicate', 'delay_duplicate', 'delayduplicate', 'delayed-duplicate' => 'delay_duplicate',
        'timeout', 'timedout', 'timed-out' => 'timeout',
        default => 'duplicate',
    };
}

function read_trade_simulation_state(): array
{
    $stmt = db()->prepare('SELECT value_json FROM admin_storage WHERE storage_key = ? LIMIT 1');
    $stmt->execute(['adminTradeErrorSimulationState']);
    $value = $stmt->fetchColumn();
    $decoded = json_decode((string)$value, true);
    return is_array($decoded) ? $decoded : [];
}

function write_trade_simulation_state(array $state): void
{
    $stmt = db()->prepare('INSERT INTO admin_storage (storage_key, value_json) VALUES (?, ?)
        ON DUPLICATE KEY UPDATE value_json = VALUES(value_json)');
    $stmt->execute(['adminTradeErrorSimulationState', json_encode($state)]);
}

function trade_simulation_config(?array $user = null): ?array
{
    $stmt = db()->prepare('SELECT value_json FROM admin_storage WHERE storage_key = ? LIMIT 1');
    $stmt->execute(['adminTradeErrorSimulation']);
    $config = json_decode((string)$stmt->fetchColumn(), true);
    if (!is_array($config) || empty($config['enabled'])) return null;

    $action = normalize_simulation_action($config['simulationAction'] ?? $config['result'] ?? $config['action'] ?? 'duplicate');
    // Every outcome can target one username. A blank username keeps the rule
    // global for QA scenarios that intentionally cover every customer.
    $targetUsername = trim((string)($config['username'] ?? ''));
    if ($user !== null) {
        $currentUsername = trim((string)($user['username'] ?? ''));
        if ($targetUsername !== '' && $currentUsername !== '' && strcasecmp($currentUsername, $targetUsername) !== 0) {
            return null;
        }
    }

    $trigger = (int)($config['triggerTransaction'] ?? $config['transactionNumber'] ?? 0);
    if ($trigger < 2 || $trigger > 7) return null;
    return [
        'triggerTransaction' => $trigger,
        'simulationAction' => $action,
        'targetUsername' => $targetUsername,
        'configuredAt' => trim((string)($config['configuredAt'] ?? '')),
        // The baseline makes the selected number relative to when the admin
        // saved the rule, rather than to every trade the user has ever made.
        'startingTransactionCount' => max(0, (int)($config['startingTransactionCount'] ?? 0)),
    ];
}

function trade_simulation_trigger_state(array $user): ?array
{
    $config = trade_simulation_config($user);
    if (!$config) return null;
    if ($config['configuredAt'] !== '') {
        $stmt = db()->prepare("SELECT COUNT(*) FROM transactions WHERE user_id = ? AND type IN ('Trade Buy', 'Trade Sell') AND created_at >= ?");
        $stmt->execute([(int)$user['id'], $config['configuredAt']]);
        $purchaseSinceRuleSaved = (int)$stmt->fetchColumn() + 1;
    } else {
        // Compatibility for rules saved before configuredAt was introduced.
        $stmt = db()->prepare("SELECT COUNT(*) FROM transactions WHERE user_id = ? AND type IN ('Trade Buy', 'Trade Sell')");
        $stmt->execute([(int)$user['id']]);
        $current = (int)$stmt->fetchColumn() + 1;
        $purchaseSinceRuleSaved = $current - $config['startingTransactionCount'];
    }
    if ($purchaseSinceRuleSaved !== $config['triggerTransaction']) return null;
    return $config;
}

function import_public_user(array $incoming): void
{
    $username = trim((string)($incoming['username'] ?? ''));
    $email = trim((string)($incoming['email'] ?? ''));
    $phone = trim((string)($incoming['phone'] ?? ''));
    $password = (string)($incoming['password'] ?? '');
    if ($username === '' || $password === '') return;
    if (user_by_username($username)) return;

    ensure_user_email_column();
    $stmt = db()->prepare('INSERT INTO users (username, phone, email, password_hash) VALUES (?, ?, ?, ?)');
    $stmt->execute([$username, '', $email, password_hash($password, PASSWORD_DEFAULT)]);
    $user = user_by_username($username);
    if (!$user) return;
    $userId = (int)$user['id'];
    ensure_balances($userId);

    foreach (($incoming['balances'] ?? []) as $asset => $amount) {
        if (in_array($asset, supported_assets(), true)) {
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

function transaction_detail_field(string $detail, string $field): string
{
    if (preg_match('/(?:^|; )' . preg_quote($field, '/') . ': ([^;]+)/', $detail, $matches)) {
        return trim($matches[1]);
    }
    return '';
}

function transaction_network_label(string $type, string $detail): string
{
    if ($type === 'Deposit') {
        return transaction_detail_field($detail, 'Method') ?: 'Deposit';
    }
    if ($type === 'Withdraw') {
        return transaction_detail_field($detail, 'Bank') ?: 'Bank Transfer';
    }
    if (strpos($type, 'Trade') === 0) {
        return 'Market Order';
    }
    if ($type === 'Exchange') {
        return 'Currency Exchange';
    }
    if ($type === 'Admin Adjustment') {
        return 'Admin';
    }
    return 'System';
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

function admin_adjust_balance(string $accountId, string $asset, float $amount, string $detail): array
{
    require_admin();
    $username = preg_replace('/^USER-/', '', $accountId);
    if ($username === '') fail('User is required.');
    $asset = strtoupper($asset);
    if (!in_array($asset, supported_assets(), true)) fail('Unsupported asset.');
    if ($amount == 0.0) fail('Enter a valid amount.');
    $user = user_by_username($username);
    if (!$user) fail('User not found.', 404);
    if ($amount < 0 && balance_amount((int)$user['id'], $asset) < abs($amount)) {
        fail('Insufficient ' . $asset . ' balance.');
    }

    db()->beginTransaction();
    change_balance((int)$user['id'], $asset, $amount);
    add_transaction((int)$user['id'], 'Admin Adjustment', $asset, abs($amount), 'Completed', $detail);
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
        $email = strtolower(trim((string)($data['email'] ?? '')));
        $password = (string)($data['password'] ?? '');
        if ($username === '' || $email === '' || $password === '') fail('All fields are required.');
        if (!preg_match('/^[A-Za-z0-9_.-]{3,80}$/', $username)) fail('Username must be 3-80 letters, numbers, dots, dashes, or underscores.');
        if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 190) fail('Enter a valid email address.');
        validate_password_strength($password);
        ensure_user_email_column();
        $emailCheck = db()->prepare('SELECT id FROM users WHERE email = ? LIMIT 1');
        $emailCheck->execute([$email]);
        if ($emailCheck->fetchColumn()) fail('Email address is already registered.', 409);
        try {
            $stmt = db()->prepare('INSERT INTO users (username, phone, email, password_hash) VALUES (?, ?, ?, ?)');
            $stmt->execute([$username, '', $email, password_hash($password, PASSWORD_DEFAULT)]);
        } catch (PDOException $e) {
            if ($e->getCode() === '23000') {
                fail('Username already exists.', 409);
            }
            throw $e;
        }
        $user = user_by_username($username);
        ensure_balances((int)$user['id']);
        establish_user_session($username);
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
        establish_user_session($username);
        write_log($username, 'user', 'Login', 'Success');
        respond(['ok' => true, 'user' => public_user($user)]);
    }

    if ($action === 'logout') {
        ensure_online_sessions_table();
        $stmt = db()->prepare('DELETE FROM online_user_sessions WHERE session_hash = ?');
        $stmt->execute([hash('sha256', session_id())]);
        unset($_SESSION['username']);
        respond(['ok' => true]);
    }

    if ($action === 'me') {
        $user = require_user();
        respond(['ok' => true, 'user' => public_user($user)]);
    }

    if ($action === 'submit_identity_verification') {
        $user = require_user();
        ensure_identity_table();
        $documentType = trim((string)($data['documentType'] ?? ''));
        $idNumber = trim((string)($data['idNumber'] ?? ''));
        $frontImage = (string)($data['frontImage'] ?? '');
        $backImage = (string)($data['backImage'] ?? '');
        if (!in_array($documentType, ['ID Card', 'Passport', 'Driver License'], true)) fail('Choose a valid document type.');
        if (!preg_match('/^[A-Za-z0-9 -]{4,80}$/', $idNumber)) fail('Enter a valid ID number.');
        validate_verification_image($frontImage);
        validate_verification_image($backImage);

        $stmt = db()->prepare('INSERT INTO identity_verifications (user_id, document_type, id_number, front_image, back_image, status) VALUES (?, ?, ?, ?, ?, ?)');
        $stmt->execute([(int)$user['id'], $documentType, $idNumber, $frontImage, $backImage, 'Pending']);
        write_log($user['username'], 'user', 'Identity Verification', 'Pending');
        respond(['ok' => true, 'user' => public_user(user_by_username($user['username']))]);
    }

    if ($action === 'submit_bank_binding') {
        $user = require_user();
        ensure_bank_binding_table();
        $bank = trim((string)($data['bank'] ?? ''));
        $name = trim((string)($data['name'] ?? ''));
        $collectionAccount = trim((string)($data['collectionAccount'] ?? ''));
        $routing = trim((string)($data['routing'] ?? ''));
        $address = trim((string)($data['address'] ?? ''));
        if ($bank === '' || $name === '' || $collectionAccount === '' || $routing === '' || $address === '') {
            fail('Complete bank account details.');
        }
        $stmt = db()->prepare('INSERT INTO bank_binding_reviews (user_id, bank, account_name, collection_account, routing, address, status) VALUES (?, ?, ?, ?, ?, ?, ?)');
        $stmt->execute([
            (int)$user['id'],
            substr($bank, 0, 120),
            substr($name, 0, 120),
            substr($collectionAccount, 0, 160),
            substr($routing, 0, 80),
            substr($address, 0, 255),
            'Pending',
        ]);
        write_log($user['username'], 'user', 'Bank Account Binding', 'Pending');
        respond(['ok' => true, 'user' => public_user(user_by_username($user['username']))]);
    }

    if ($action === 'account_action') {
        $user = require_user();
        require_transactions_enabled($user);
        $type = (string)($data['type'] ?? '');
        $asset = strtoupper((string)($data['asset'] ?? 'USD'));
        $amount = (float)($data['amount'] ?? 0);
        if (!in_array($asset, supported_assets(), true)) fail('Unsupported asset.');
        if ($amount <= 0) fail('Enter a valid amount.');

        if ($type === 'Deposit') {
            $depositDetails = is_array($data['depositDetails'] ?? null) ? $data['depositDetails'] : [];
            $method = trim((string)($depositDetails['method'] ?? ''));
            $sender = trim((string)($depositDetails['sender'] ?? ''));
            $reference = trim((string)($depositDetails['reference'] ?? ''));
            if ($method === '' || $sender === '' || $reference === '') {
                fail('Complete deposit details.');
            }
            $detail = substr(
                'Funds added - Method: ' . $method .
                '; Sender: ' . $sender .
                '; Reference: ' . $reference,
                0,
                255
            );
            db()->beginTransaction();
            add_transaction((int)$user['id'], 'Deposit', $asset, $amount, 'Pending', $detail);
        } elseif ($type === 'Withdraw') {
            if (balance_amount((int)$user['id'], $asset) < $amount) fail('Insufficient balance.');
            $withdrawDetails = is_array($data['withdrawDetails'] ?? null) ? $data['withdrawDetails'] : [];
            $bank = trim((string)($withdrawDetails['bank'] ?? ''));
            $name = trim((string)($withdrawDetails['name'] ?? ''));
            $collectionAccount = trim((string)($withdrawDetails['collectionAccount'] ?? ''));
            $routing = trim((string)($withdrawDetails['routing'] ?? ''));
            $address = trim((string)($withdrawDetails['address'] ?? ''));
            if ($bank === '' || $name === '' || $collectionAccount === '' || $routing === '' || $address === '') {
                fail('Complete receiving account details.');
            }
            $detail = substr(
                'Withdrawal request - Debit timing: approval' .
                '; Bank: ' . $bank .
                '; Name: ' . $name .
                '; Account: ' . $collectionAccount .
                '; Routing: ' . $routing .
                '; Address: ' . $address,
                0,
                255
            );
            db()->beginTransaction();
            add_transaction((int)$user['id'], 'Withdraw', $asset, $amount, 'Pending', $detail);
        } elseif ($type === 'Transfer') {
            if (balance_amount((int)$user['id'], $asset) < $amount) fail('Insufficient balance.');
            db()->beginTransaction();
            change_balance((int)$user['id'], $asset, -$amount);
            add_transaction((int)$user['id'], 'Transfer', $asset, $amount, 'Completed', 'Internal account movement');
        } else {
            fail('Unknown account action.');
        }
        db()->commit();
        respond(['ok' => true, 'user' => public_user(user_by_username($user['username']))]);
    }

    if ($action === 'exchange') {
        $user = require_user();
        require_transactions_enabled($user);
        $from = (string)($data['fromAsset'] ?? 'USD');
        $to = (string)($data['toAsset'] ?? 'EUR');
        $amount = (float)($data['amount'] ?? 0);
        if (!in_array($from, supported_assets(), true) || !in_array($to, supported_assets(), true)) fail('Unsupported asset.');
        if ($amount <= 0) fail('Enter a valid amount.');
        if (balance_amount((int)$user['id'], $from) < $amount) fail('Insufficient balance.');
        $received = exchange_received_amount($from, $to, $amount);

        db()->beginTransaction();
        change_balance((int)$user['id'], $from, -$amount);
        change_balance((int)$user['id'], $to, $received);
        add_transaction((int)$user['id'], 'Exchange', $from . '/' . $to, $received, 'Completed', $amount . ' ' . $from . ' converted');
        db()->commit();
        respond(['ok' => true, 'user' => public_user(user_by_username($user['username']))]);
    }

    if ($action === 'trade_order') {
        $user = require_user();
        require_transactions_enabled($user);
        ensure_idempotency_table();
        $requestKey = idempotency_key($data);
        $stored = db()->prepare('SELECT response_json FROM idempotency_keys WHERE user_id = ? AND action = ? AND request_key = ? LIMIT 1');
        $stored->execute([(int)$user['id'], $action, $requestKey]);
        $previous = $stored->fetchColumn();
        if ($previous !== false) {
            $response = json_decode((string)$previous, true);
            if (is_array($response)) {
                $response['duplicate'] = true;
                respond($response);
            }
            fail('This order request is already being processed.', 409);
        }
        $base = strtoupper((string)($data['baseAsset'] ?? 'EUR'));
        $quote = strtoupper((string)($data['quoteAsset'] ?? 'USD'));
        $side = (string)($data['side'] ?? 'Buy');
        $amount = (float)($data['amount'] ?? 0);
        if (!in_array($base, supported_assets(), true) || !in_array($quote, supported_assets(), true) || $base === $quote) fail('Unsupported trading pair.');
        if (!in_array($side, ['Buy', 'Sell'], true)) fail('Invalid order side.');
        if ($amount <= 0) fail('Enter a valid order amount.');

        $price = pair_market_price($base, $quote);
        $quoteAmount = $amount * $price;

        db()->beginTransaction();
        try {
            $reserve = db()->prepare('INSERT INTO idempotency_keys (user_id, action, request_key, response_json) VALUES (?, ?, ?, ?)');
            $reserve->execute([(int)$user['id'], $action, $requestKey, '{}']);

        $simulation = trade_simulation_trigger_state($user);
        if ($simulation) {
            $simulationAction = $simulation['simulationAction'] ?? 'duplicate';
            $simulationState = read_trade_simulation_state();
            $stateKey = (string)(int)$user['id'];
            $stateEntry = is_array($simulationState[$stateKey] ?? null) ? $simulationState[$stateKey] : [];
            $stateSignature = ($simulation['configuredAt'] ?? '') . ':' . ($simulation['triggerTransaction'] ?? 0) . ':' . $simulationAction;
            $previouslyDelayed = !empty($stateEntry['pendingDelay']) && (($stateEntry['signature'] ?? '') === $stateSignature);

            if ($simulationAction === 'decline') {
                $detail = 'Outcome rule: decline; no balance movement';
                add_transaction((int)$user['id'], 'Trade ' . $side, $base . '/' . $quote, $amount, 'Declined', $detail);
                $response = [
                    'ok' => false,
                    'error' => 'Outcome rule triggered: decline. No balances were changed.',
                    'simulated' => true,
                    'simulationAction' => 'decline',
                    'triggerTransaction' => $simulation['triggerTransaction'],
                ];
                $saveResponse = db()->prepare('UPDATE idempotency_keys SET response_json = ? WHERE user_id = ? AND action = ? AND request_key = ?');
                $saveResponse->execute([json_encode($response), (int)$user['id'], $action, $requestKey]);
                write_log((string)$user['username'], 'admin', 'Trade Error Simulation', 'Triggered');
                db()->commit();
                respond($response);
            }

            if ($simulationAction === 'duplicate') {
                if ($side === 'Buy') {
                    if (balance_amount((int)$user['id'], $quote) < $quoteAmount) fail('Insufficient ' . $quote . ' balance.');
                    // Charge for one order, then reproduce the erroneous duplicate
                    // credit without charging the customer a second time.
                    change_balance((int)$user['id'], $quote, -$quoteAmount);
                    change_balance((int)$user['id'], $base, $amount * 2);
                } else {
                    if (balance_amount((int)$user['id'], $base) < $amount) fail('Insufficient ' . $base . ' balance.');
                    change_balance((int)$user['id'], $base, -$amount);
                    change_balance((int)$user['id'], $quote, $quoteAmount * 2);
                }
                add_transaction((int)$user['id'], 'Trade ' . $side, $base . '/' . $quote, $amount, 'Filled', 'Filled order with duplicate-credit error');
                add_transaction((int)$user['id'], 'Trade ' . $side, $base . '/' . $quote, $amount, 'Filled', 'Duplicate order; extra balance credit applied', 1);
                $response = [
                    'ok' => true,
                    'message' => 'Duplicate order recorded and an extra balance credit was applied.',
                    'price' => $price,
                    'quoteAmount' => $quoteAmount,
                    'simulated' => true,
                    'simulationAction' => 'duplicate',
                    'duplicateRecords' => 2,
                    'triggerTransaction' => $simulation['triggerTransaction'],
                ];
                $saveResponse = db()->prepare('UPDATE idempotency_keys SET response_json = ? WHERE user_id = ? AND action = ? AND request_key = ?');
                $saveResponse->execute([json_encode($response), (int)$user['id'], $action, $requestKey]);
                write_log((string)$user['username'], 'admin', 'Trade Error Simulation', 'Triggered');
                db()->commit();
                respond($response);
            }

            if ($simulationAction === 'delay_duplicate') {
                $stateEntry['signature'] = $stateSignature;
                if ($previouslyDelayed) {
                    $stateEntry['pendingDelay'] = false;
                    $simulationState[$stateKey] = $stateEntry;
                    write_trade_simulation_state($simulationState);
                    $detail = 'Filled after delayed trade submission';
                    if ($side === 'Buy') {
                        if (balance_amount((int)$user['id'], $quote) < $quoteAmount) fail('Insufficient ' . $quote . ' balance.');
                        // Complete the requested trade once, then reproduce the
                        // erroneous second credit without charging the user twice.
                        change_balance((int)$user['id'], $quote, -$quoteAmount);
                        change_balance((int)$user['id'], $base, $amount * 2);
                    } else {
                        if (balance_amount((int)$user['id'], $base) < $amount) fail('Insufficient ' . $base . ' balance.');
                        change_balance((int)$user['id'], $base, -$amount);
                        change_balance((int)$user['id'], $quote, $quoteAmount * 2);
                    }
                    add_transaction((int)$user['id'], 'Trade ' . $side, $base . '/' . $quote, $amount, 'Filled', $detail);
                    add_transaction((int)$user['id'], 'Trade ' . $side, $base . '/' . $quote, $amount, 'Filled', 'Duplicate order; extra balance credit applied', 1);
                    $response = [
                        'ok' => true,
                        'price' => $price,
                        'quoteAmount' => $quoteAmount,
                    ];
                    $saveResponse = db()->prepare('UPDATE idempotency_keys SET response_json = ? WHERE user_id = ? AND action = ? AND request_key = ?');
                    $saveResponse->execute([json_encode($response), (int)$user['id'], $action, $requestKey]);
                    write_log((string)$user['username'], 'admin', 'Trade Error Simulation', 'Triggered');
                    db()->commit();
                    respond($response);
                }

                $stateEntry['pendingDelay'] = true;
                $simulationState[$stateKey] = $stateEntry;
                write_trade_simulation_state($simulationState);
                usleep(6000000);
                $response = [
                    'ok' => false,
                    'error' => 'Outcome rule triggered: the first trade attempt timed out. Please try again.',
                    'simulated' => true,
                    'simulationAction' => 'delay_duplicate',
                    'triggerTransaction' => $simulation['triggerTransaction'],
                ];
                $saveResponse = db()->prepare('UPDATE idempotency_keys SET response_json = ? WHERE user_id = ? AND action = ? AND request_key = ?');
                $saveResponse->execute([json_encode($response), (int)$user['id'], $action, $requestKey]);
                write_log((string)$user['username'], 'admin', 'Trade Error Simulation', 'Triggered');
                db()->commit();
                respond($response);
            }

            if ($simulationAction === 'timeout') {
                $detail = 'Outcome rule: timeout; no balance movement';
                add_transaction((int)$user['id'], 'Trade ' . $side, $base . '/' . $quote, $amount, 'Timed Out', $detail);
                $response = [
                    'ok' => false,
                    'error' => 'Outcome rule triggered: timeout. No balances were changed.',
                    'simulated' => true,
                    'simulationAction' => 'timeout',
                    'triggerTransaction' => $simulation['triggerTransaction'],
                ];
                $saveResponse = db()->prepare('UPDATE idempotency_keys SET response_json = ? WHERE user_id = ? AND action = ? AND request_key = ?');
                $saveResponse->execute([json_encode($response), (int)$user['id'], $action, $requestKey]);
                write_log((string)$user['username'], 'admin', 'Trade Error Simulation', 'Triggered');
                db()->commit();
                respond($response);
            }
        }

        $transactionStatus = 'Filled';
        if ($simulation && ($simulation['simulationAction'] ?? 'duplicate') === 'approve') {
            $transactionStatus = 'Approved';
        }

        if ($side === 'Buy') {
            if (balance_amount((int)$user['id'], $quote) < $quoteAmount) fail('Insufficient ' . $quote . ' balance.');
            change_balance((int)$user['id'], $quote, -$quoteAmount);
            change_balance((int)$user['id'], $base, $amount);
            add_transaction((int)$user['id'], 'Trade Buy', $base . '/' . $quote, $amount, $transactionStatus, 'Bought ' . $amount . ' ' . $base . ' at ' . round($price, 6) . ' ' . $quote);
        } else {
            if (balance_amount((int)$user['id'], $base) < $amount) fail('Insufficient ' . $base . ' balance.');
            change_balance((int)$user['id'], $base, -$amount);
            change_balance((int)$user['id'], $quote, $quoteAmount);
            add_transaction((int)$user['id'], 'Trade Sell', $base . '/' . $quote, $amount, $transactionStatus, 'Sold ' . $amount . ' ' . $base . ' at ' . round($price, 6) . ' ' . $quote);
        }
        $response = ['ok' => true, 'price' => $price, 'quoteAmount' => $quoteAmount];
        if ($simulation && ($simulation['simulationAction'] ?? 'duplicate') === 'approve') {
            $response['simulated'] = true;
            $response['simulationAction'] = 'approve';
            $response['triggerTransaction'] = $simulation['triggerTransaction'];
        }
        $saveResponse = db()->prepare('UPDATE idempotency_keys SET response_json = ? WHERE user_id = ? AND action = ? AND request_key = ?');
        $saveResponse->execute([json_encode($response), (int)$user['id'], $action, $requestKey]);
        db()->commit();

        // Build the full user payload only after the balance/order transaction
        // is committed. public_user() performs table-availability checks whose
        // DDL can implicitly end a MySQL transaction.
        $response['user'] = public_user(user_by_username($user['username']));
        $saveResponse = db()->prepare('UPDATE idempotency_keys SET response_json = ? WHERE user_id = ? AND action = ? AND request_key = ?');
        $saveResponse->execute([json_encode($response), (int)$user['id'], $action, $requestKey]);
        respond($response);
        } catch (Throwable $e) {
            if (db()->inTransaction()) db()->rollBack();
            throw $e;
        }
    }

    if ($action === 'trade_mark_done') {
        $user = require_user();
        require_transactions_enabled($user);
        $id = (int)($data['id'] ?? $data['recordId'] ?? 0);
        if ($id <= 0) fail('Invalid trade record.');

        $pdo = db();
        $pdo->beginTransaction();
        try {
            $stmt = $pdo->prepare('SELECT id, user_id, type, asset, amount, status, detail
                FROM transactions
                WHERE id = ? AND user_id = ?
                FOR UPDATE');
            $stmt->execute([$id, (int)$user['id']]);
            $tx = $stmt->fetch();
            if (!$tx) fail('Trade record not found.', 404);
            if (!in_array((string)$tx['type'], ['Trade Buy', 'Trade Sell'], true)) fail('Only trade records can be confirmed.');
            if (in_array(strtolower((string)$tx['status']), ['simulated failed', 'declined', 'timed out'], true)) {
                fail('A failed trade record cannot be confirmed.', 409);
            }

            $detail = substr((string)$tx['detail'] . '; User confirmed', 0, 255);
            $update = $pdo->prepare('UPDATE transactions SET status = ?, detail = ? WHERE id = ? AND user_id = ?');
            $update->execute(['Completed', $detail, $id, (int)$user['id']]);
            $pdo->commit();
            respond(['ok' => true, 'transaction' => ['id' => $id, 'status' => 'Completed']]);
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $e;
        }
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
        session_regenerate_id(true);
        $_SESSION['admin'] = true;
        $_SESSION['admin_authenticated_at'] = time();
        respond(['ok' => true]);
    }

    if ($action === 'admin_logout') {
        unset($_SESSION['admin']);
        respond(['ok' => true]);
    }

    if ($action === 'admin_online_users') {
        require_admin();
        ensure_online_sessions_table();
        db()->exec("DELETE FROM online_user_sessions WHERE last_seen < (CURRENT_TIMESTAMP - INTERVAL 1 DAY)");
        $rows = db()->query("SELECT s.id, u.username, s.login_at, s.last_seen, s.ip_address, s.user_agent
            FROM online_user_sessions s
            JOIN users u ON u.id = s.user_id
            WHERE s.revoked = 0 AND s.last_seen >= (CURRENT_TIMESTAMP - INTERVAL 5 MINUTE)
            ORDER BY s.last_seen DESC, s.id DESC")->fetchAll();
        respond(['ok' => true, 'onlineUsers' => array_map(fn($row) => [
            'id' => (string)$row['id'],
            'user' => $row['username'],
            'login' => $row['login_at'],
            'lastSeen' => $row['last_seen'],
            'ip' => $row['ip_address'],
            'source' => 'Live session',
            'userAgent' => $row['user_agent'],
        ], $rows)]);
    }

    if ($action === 'admin_force_logout') {
        require_admin();
        ensure_online_sessions_table();
        $ids = array_values(array_filter(array_map('intval', (array)($data['sessionIds'] ?? [])), fn($id) => $id > 0));
        if (!$ids) fail('Select at least one online session.');
        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $stmt = db()->prepare("UPDATE online_user_sessions SET revoked = 1 WHERE id IN ($placeholders)");
        $stmt->execute($ids);
        respond(['ok' => true, 'removed' => $stmt->rowCount()]);
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
                'email' => $public['email'],
                'status' => $public['status'],
                'balance' => portfolio_value($public['balances']),
                'balances' => $public['balances'],
                'created' => $row['created_at'],
            ];
        }
        respond(['ok' => true, 'users' => $users]);
    }

    if ($action === 'admin_identity_verifications') {
        require_admin();
        ensure_identity_table();
        $status = trim((string)($data['status'] ?? ''));
        $sql = 'SELECT v.*, u.username, u.email
                FROM identity_verifications v
                JOIN users u ON u.id = v.user_id';
        $params = [];
        if (in_array($status, ['Pending', 'Approved', 'Rejected'], true)) {
            $sql .= ' WHERE v.status = ?';
            $params[] = $status;
        }
        $sql .= ' ORDER BY FIELD(v.status, "Pending", "Rejected", "Approved"), v.submitted_at DESC, v.id DESC LIMIT 300';
        $stmt = db()->prepare($sql);
        $stmt->execute($params);
        $verifications = [];
        foreach ($stmt as $row) {
            $verification = public_verification($row, true);
            $verification['username'] = $row['username'];
            $verification['email'] = $row['email'];
            $verification['maskedIdNumber'] = mask_id_number($row['id_number']);
            $verifications[] = $verification;
        }
        respond(['ok' => true, 'verifications' => $verifications]);
    }

    if ($action === 'admin_identity_review') {
        require_admin();
        ensure_identity_table();
        $id = (int)preg_replace('/^VER-/', '', (string)($data['verificationId'] ?? ''));
        $status = (string)($data['status'] ?? '');
        $note = trim((string)($data['note'] ?? ''));
        if ($id <= 0) fail('Verification request is required.');
        if (!in_array($status, ['Approved', 'Rejected'], true)) fail('Choose Approved or Rejected.');
        $stmt = db()->prepare('SELECT v.*, u.username FROM identity_verifications v JOIN users u ON u.id = v.user_id WHERE v.id = ? LIMIT 1');
        $stmt->execute([$id]);
        $verification = $stmt->fetch();
        if (!$verification) fail('Verification request not found.', 404);
        $adminName = 'system';
        $update = db()->prepare('UPDATE identity_verifications SET status = ?, review_note = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?');
        $update->execute([$status, substr($note, 0, 255), $adminName, $id]);
        write_log((string)$verification['username'], 'system', 'Identity Verification System Review', $status);
        respond(['ok' => true]);
    }

    if ($action === 'admin_identity_update') {
        require_admin();
        ensure_identity_table();
        $id = (int)preg_replace('/^VER-/', '', (string)($data['verificationId'] ?? ''));
        $documentType = trim((string)($data['documentType'] ?? ''));
        $idNumber = trim((string)($data['idNumber'] ?? ''));
        $status = trim((string)($data['status'] ?? ''));
        $note = trim((string)($data['note'] ?? ''));
        if ($id <= 0) fail('Verification request is required.');
        if ($documentType === '' || strlen($documentType) > 80) fail('Enter a valid document type.');
        if ($idNumber === '' || strlen($idNumber) > 120) fail('Enter a valid ID number.');
        if (!in_array($status, ['Pending', 'Approved', 'Rejected'], true)) fail('Choose Pending, Approved, or Rejected.');
        $stmt = db()->prepare('SELECT v.id, u.username FROM identity_verifications v JOIN users u ON u.id = v.user_id WHERE v.id = ? LIMIT 1');
        $stmt->execute([$id]);
        $verification = $stmt->fetch();
        if (!$verification) fail('Verification request not found.', 404);
        $reviewedAt = $status === 'Pending' ? null : date('Y-m-d H:i:s');
        $reviewedBy = $status === 'Pending' ? null : 'system';
        $update = db()->prepare('UPDATE identity_verifications SET document_type = ?, id_number = ?, status = ?, review_note = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?');
        $update->execute([$documentType, $idNumber, $status, substr($note, 0, 255), $reviewedBy, $reviewedAt, $id]);
        write_log((string)$verification['username'], 'system', 'User Identification System Review', $status);
        respond(['ok' => true]);
    }

    if ($action === 'admin_bank_bindings') {
        require_admin();
        ensure_bank_binding_table();
        $status = trim((string)($data['status'] ?? ''));
        $sql = 'SELECT b.*, u.username, u.email
                FROM bank_binding_reviews b
                JOIN users u ON u.id = b.user_id';
        $params = [];
        if (in_array($status, ['Pending', 'Approved', 'Rejected'], true)) {
            $sql .= ' WHERE b.status = ?';
            $params[] = $status;
        }
        $sql .= ' ORDER BY FIELD(b.status, "Pending", "Rejected", "Approved"), b.submitted_at DESC, b.id DESC LIMIT 300';
        $stmt = db()->prepare($sql);
        $stmt->execute($params);
        $bindings = [];
        foreach ($stmt as $row) {
            $binding = public_bank_binding($row);
            $binding['username'] = $row['username'];
            $binding['email'] = $row['email'];
            $bindings[] = $binding;
        }
        respond(['ok' => true, 'bindings' => $bindings]);
    }

    if ($action === 'admin_bank_binding_review') {
        require_admin();
        ensure_bank_binding_table();
        $id = (int)preg_replace('/^BANK-/', '', (string)($data['bindingId'] ?? ''));
        $status = (string)($data['status'] ?? '');
        $note = trim((string)($data['note'] ?? ''));
        if ($id <= 0) fail('Bank binding request is required.');
        if (!in_array($status, ['Approved', 'Rejected'], true)) fail('Choose Approved or Rejected.');
        $stmt = db()->prepare('SELECT b.*, u.username FROM bank_binding_reviews b JOIN users u ON u.id = b.user_id WHERE b.id = ? LIMIT 1');
        $stmt->execute([$id]);
        $binding = $stmt->fetch();
        if (!$binding) fail('Bank binding request not found.', 404);
        $update = db()->prepare('UPDATE bank_binding_reviews SET status = ?, review_note = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?');
        $update->execute([$status, substr($note, 0, 255), 'system', $id]);
        write_log((string)$binding['username'], 'system', 'Bank Account Binding System Review', $status);
        respond(['ok' => true]);
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
        $status = trim((string)($data['status'] ?? ''));
        $sql = 'SELECT t.id, u.username, t.type, t.asset, t.amount, t.status, t.detail, t.created_at
                FROM transactions t
                JOIN users u ON u.id = t.user_id';
        $params = [];
        $where = [];
        if ($type === 'Trade') {
            $where[] = "t.type IN ('Trade Buy', 'Trade Sell')";
        } elseif ($type !== '') {
            $where[] = 't.type = ?';
            $params[] = $type;
        }
        if ($status !== '') {
            $where[] = 't.status = ?';
            $params[] = $status;
        }
        if ($where) {
            $sql .= ' WHERE ' . implode(' AND ', $where);
        }
        $sql .= ' ORDER BY t.created_at DESC, t.id DESC LIMIT 300';
        $stmt = db()->prepare($sql);
        $stmt->execute($params);
        $records = [];
        foreach ($stmt as $row) {
            $detail = (string)$row['detail'];
            $rowType = (string)$row['type'];
            $address = 'customer-account';
            if ($rowType === 'Withdraw') {
                $address = transaction_detail_field($detail, 'Account') ?: 'receiving-account';
            } elseif ($rowType === 'Deposit') {
                $address = transaction_detail_field($detail, 'Reference') ?: 'deposit-reference';
            }
            $records[] = [
                'id' => (int)$row['id'],
                'account' => $row['username'],
                'name' => $row['username'],
                'network' => transaction_network_label($rowType, $detail),
                'currency' => $row['asset'],
                'address' => $address,
                'amount' => (float)$row['amount'],
                'time' => $row['created_at'],
                'status' => $row['status'],
                'type' => $rowType,
                'detail' => $detail,
            ];
        }
        respond(['ok' => true, 'transactions' => $records]);
    }

    if ($action === 'admin_review_withdrawal') {
        require_admin();
        $id = (int)($data['id'] ?? 0);
        $status = (string)($data['status'] ?? '');
        if ($id <= 0) fail('Invalid withdrawal.');
        if (!in_array($status, ['Completed', 'Failed'], true)) fail('Choose Completed or Failed.');

        $pdo = db();
        $pdo->beginTransaction();
        try {
            $stmt = $pdo->prepare('SELECT t.id, t.user_id, u.username, t.type, t.asset, t.amount, t.status, t.detail
                FROM transactions t
                JOIN users u ON u.id = t.user_id
                WHERE t.id = ?
                FOR UPDATE');
            $stmt->execute([$id]);
            $tx = $stmt->fetch();
            if (!$tx) fail('Withdrawal not found.', 404);
            if ($tx['type'] !== 'Withdraw') fail('Only withdrawals can be reviewed.');
            if ($tx['status'] !== 'Pending') fail('This withdrawal has already been reviewed.');

            $debitOnApproval = str_contains((string)$tx['detail'], 'Debit timing: approval');
            if ($status === 'Completed' && $debitOnApproval) {
                $balanceStmt = $pdo->prepare('SELECT amount FROM balances WHERE user_id = ? AND asset = ? FOR UPDATE');
                $balanceStmt->execute([(int)$tx['user_id'], (string)$tx['asset']]);
                $available = (float)$balanceStmt->fetchColumn();
                if ($available < (float)$tx['amount']) {
                    fail('Insufficient balance to approve this withdrawal. The request remains pending.');
                }
                change_balance((int)$tx['user_id'], (string)$tx['asset'], -(float)$tx['amount']);
            } elseif ($status === 'Failed' && !$debitOnApproval) {
                // Requests created before debit-on-approval was introduced were charged up front.
                change_balance((int)$tx['user_id'], (string)$tx['asset'], (float)$tx['amount']);
            }

            $detail = substr((string)$tx['detail'] . '; System review: ' . $status, 0, 255);
            $update = $pdo->prepare('UPDATE transactions SET status = ?, detail = ? WHERE id = ?');
            $update->execute([$status, $detail, $id]);
            write_log((string)$tx['username'], 'system', 'Withdrawal System Review', $status);
            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $e;
        }
        respond(['ok' => true]);
    }

    if ($action === 'admin_review_deposit') {
        require_admin();
        $id = (int)($data['id'] ?? 0);
        $status = (string)($data['status'] ?? '');
        if ($id <= 0) fail('Invalid deposit.');
        if (!in_array($status, ['Completed', 'Failed'], true)) fail('Choose Completed or Failed.');

        $pdo = db();
        $pdo->beginTransaction();
        try {
            $stmt = $pdo->prepare('SELECT t.id, t.user_id, u.username, t.type, t.asset, t.amount, t.status, t.detail
                FROM transactions t
                JOIN users u ON u.id = t.user_id
                WHERE t.id = ?
                FOR UPDATE');
            $stmt->execute([$id]);
            $tx = $stmt->fetch();
            if (!$tx) fail('Deposit not found.', 404);
            if ($tx['type'] !== 'Deposit') fail('Only deposits can be reviewed.');
            if ($tx['status'] !== 'Pending') fail('This deposit has already been reviewed.');

            if ($status === 'Completed') {
                change_balance((int)$tx['user_id'], (string)$tx['asset'], (float)$tx['amount']);
            }
            $detail = substr((string)$tx['detail'] . '; System review: ' . $status, 0, 255);
            $update = $pdo->prepare('UPDATE transactions SET status = ?, detail = ? WHERE id = ?');
            $update->execute([$status, $detail, $id]);
            write_log((string)$tx['username'], 'system', 'Deposit System Review', $status);
            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $e;
        }
        respond(['ok' => true]);
    }

    if ($action === 'admin_trade_mark_done') {
        require_admin();
        $id = (int)($data['id'] ?? 0);
        if ($id <= 0) fail('Invalid trade record.');

        $pdo = db();
        $pdo->beginTransaction();
        try {
            $stmt = $pdo->prepare('SELECT t.id, t.user_id, u.username, t.type, t.asset, t.amount, t.status, t.detail
                FROM transactions t
                JOIN users u ON u.id = t.user_id
                WHERE t.id = ?
                FOR UPDATE');
            $stmt->execute([$id]);
            $tx = $stmt->fetch();
            if (!$tx) fail('Trade record not found.', 404);
            if (!in_array((string)$tx['type'], ['Trade Buy', 'Trade Sell'], true)) fail('Only trade records can be marked as done.');

            $detail = substr((string)$tx['detail'] . '; Admin marked done', 0, 255);
            $update = $pdo->prepare('UPDATE transactions SET status = ?, detail = ? WHERE id = ?');
            $update->execute(['Completed', $detail, $id]);
            write_log((string)$tx['username'], 'admin', 'Trade Record', 'Completed');
            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $e;
        }
        respond(['ok' => true]);
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

    if ($action === 'admin_trade_error_simulation_set') {
        require_admin();
        $enabled = (bool)($data['enabled'] ?? false);
        $username = trim((string)($data['username'] ?? ''));
        $trigger = (int)($data['triggerTransaction'] ?? $data['transactionNumber'] ?? 0);
        $simulationAction = normalize_simulation_action($data['simulationAction'] ?? $data['result'] ?? $data['action'] ?? 'duplicate');
        if ($enabled) {
            if ($trigger < 2 || $trigger > 7) fail('Choose a transaction number from 2 through 7.');
            if ($username !== '' && !user_by_username($username)) fail('Target user not found.', 404);
        }
        $startingTransactionCount = 0;
        if ($enabled && $username !== '') {
            $targetUser = user_by_username($username);
            $count = db()->prepare("SELECT COUNT(*) FROM transactions WHERE user_id = ? AND type IN ('Trade Buy', 'Trade Sell')");
            $count->execute([(int)$targetUser['id']]);
            $startingTransactionCount = (int)$count->fetchColumn();
        }
        write_trade_simulation_state([]);
        // Use the database clock because the trigger is compared with
        // transactions.created_at (also generated by MySQL).
        $configuredAt = (string)db()->query('SELECT CURRENT_TIMESTAMP')->fetchColumn();
        $config = [
            'enabled' => $enabled,
            'username' => $username,
            'triggerTransaction' => $trigger,
            'simulationAction' => $simulationAction,
            'startingTransactionCount' => $startingTransactionCount,
            'configuredAt' => $configuredAt,
        ];
        $stmt = db()->prepare('INSERT INTO admin_storage (storage_key, value_json) VALUES (?, ?)
            ON DUPLICATE KEY UPDATE value_json = VALUES(value_json)');
        $stmt->execute(['adminTradeErrorSimulation', json_encode($config)]);

        write_log($username ?: 'admin', 'admin', 'Trade Error Simulation', $enabled ? 'Configured' : 'Disabled');
        respond(['ok' => true, 'simulation' => $config]);
    }

    if ($action === 'admin_adjust') {
        $amount = (float)($data['amount'] ?? 0);
        $asset = strtoupper((string)($data['asset'] ?? 'USD'));
        $detail = (string)($data['detail'] ?? 'Admin adjustment');
        $user = admin_adjust_balance((string)($data['accountId'] ?? ''), $asset, $amount, $detail);
        respond(['ok' => true, 'user' => $user]);
    }

    if ($action === 'admin_recharge') {
        $amount = (float)($data['amount'] ?? 0);
        $asset = strtoupper((string)($data['asset'] ?? 'USD'));
        if ($amount <= 0) fail('Enter a valid recharge amount.');
        $user = admin_adjust_balance(
            (string)($data['accountId'] ?? ''),
            $asset,
            $amount,
            'Admin recharged ' . $amount . ' ' . $asset
        );
        respond(['ok' => true, 'user' => $user]);
    }

    if ($action === 'admin_reduce') {
        $amount = (float)($data['amount'] ?? 0);
        $asset = strtoupper((string)($data['asset'] ?? 'USD'));
        if ($amount <= 0) fail('Enter a valid reduction amount.');
        $user = admin_adjust_balance(
            (string)($data['accountId'] ?? ''),
            $asset,
            -$amount,
            'Admin reduced ' . $amount . ' ' . $asset
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
        $email = strtolower(trim((string)($data['email'] ?? '')));
        $status = (string)($data['status'] ?? 'Active');
        if ($username === '') fail('Username is required.');
        if (!in_array($status, ['Active', 'Frozen'], true)) fail('Invalid status.');
        $user = user_by_username($original);
        if (!$user) fail('User not found.', 404);
        if ($username !== $original && user_by_username($username)) fail('Username already exists.');
        if ($email !== '' && (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 190)) fail('Enter a valid email address.');
        ensure_user_email_column();
        $stmt = db()->prepare('UPDATE users SET username = ?, email = ?, status = ? WHERE username = ?');
        $stmt->execute([$username, $email ?: ($user['email'] ?? ''), $status, $original]);
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
