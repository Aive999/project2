<?php
declare(strict_types=1);

/*
 * Hostinger setup:
 * 1. Create a MySQL database in hPanel.
 * 2. Import api/schema.sql into that database.
 * 3. Replace the values below with your Hostinger database credentials.
 */
const DB_HOST = 'localhost';
const DB_NAME = 'u504210474_cmc';
const DB_USER = 'u504210474_cmcadmin';
const DB_PASS = '89PRbta|6pC=';

function db(): PDO
{
    static $pdo = null;

    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $dsn = 'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4';
    $pdo = new PDO($dsn, DB_USER, DB_PASS, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);

    return $pdo;
}
