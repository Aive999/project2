# PHP + MySQL Setup

Use this folder when hosting the project on Hostinger.

## 1. Create the database

In Hostinger hPanel, create a MySQL database and user.

## 2. Import the schema

Open phpMyAdmin for that database and import:

```text
api/schema.sql
```

This creates:

- `users`
- `balances`
- `transactions`
- `login_logs`
- `admin_users`
- `admin_storage`

The default admin login remains:

```text
username: admin
password: admin@12345
```

## 3. Edit database credentials

Open `api/db.php` and replace:

```php
const DB_HOST = 'localhost';
const DB_NAME = 'your_database_name';
const DB_USER = 'your_database_user';
const DB_PASS = 'your_database_password';
```

Use the exact values from Hostinger hPanel.

## 4. Upload the files

Upload the whole project to `public_html`, including the `api` folder.

The frontend calls:

```text
/api/index.php
```

So the API folder must be at the same level as `index.html`.

## Test-only trade error simulation

For QA, an authenticated admin can call `admin_trade_error_simulation_set` with
`enabled`, a test username beginning with `test_`, and `triggerTransaction` from
2 through 7. The selected trade returns a clearly marked simulated error and
creates two `Simulated Failed` records with the same amount. It never changes
balances and does not apply to non-test accounts.
