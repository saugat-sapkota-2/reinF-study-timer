<?php
$host = 'localhost';
$user = 'root';
$pass = '';
$dbname = 'study_tracker';

try {
    // Initial connection to MySQL server without database selected
    $pdo = new PDO("mysql:host=$host", $user, $pass);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    
    // Create database if not exists
    $pdo->exec("CREATE DATABASE IF NOT EXISTS `$dbname` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
    
    // Select the database
    $pdo->exec("USE `$dbname`");

    // Create table users if it doesn't exist
    $createUsersTableQuery = "
        CREATE TABLE IF NOT EXISTS `users` (
            `id` INT AUTO_INCREMENT PRIMARY KEY,
            `username` VARCHAR(50) NOT NULL UNIQUE,
            `password` VARCHAR(255) NOT NULL,
            `role` VARCHAR(20) NOT NULL DEFAULT 'user',
            `last_seen` TIMESTAMP NULL DEFAULT NULL,
            `timer_status` VARCHAR(20) DEFAULT 'idle',
            `timer_subject` VARCHAR(255) DEFAULT NULL,
            `timer_started_at` DATETIME DEFAULT NULL,
            `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    ";
    $pdo->exec($createUsersTableQuery);

    // Ensure users columns exist for existing databases
    $usersColumns = $pdo->query("SHOW COLUMNS FROM `users`")->fetchAll(PDO::FETCH_COLUMN);
    if (!in_array('last_seen', $usersColumns)) {
        $pdo->exec("ALTER TABLE `users` ADD COLUMN `last_seen` TIMESTAMP NULL DEFAULT NULL");
    }
    if (!in_array('timer_status', $usersColumns)) {
        $pdo->exec("ALTER TABLE `users` ADD COLUMN `timer_status` VARCHAR(20) DEFAULT 'idle'");
    }
    if (!in_array('timer_subject', $usersColumns)) {
        $pdo->exec("ALTER TABLE `users` ADD COLUMN `timer_subject` VARCHAR(255) DEFAULT NULL");
    }
    if (!in_array('timer_started_at', $usersColumns)) {
        $pdo->exec("ALTER TABLE `users` ADD COLUMN `timer_started_at` DATETIME DEFAULT NULL");
    }

    // Seed default users if users table is empty
    $userCount = $pdo->query("SELECT COUNT(*) FROM `users`")->fetchColumn();
    if ($userCount == 0) {
        $adminPassword = password_hash('admin', PASSWORD_DEFAULT);
        $userPassword = password_hash('user', PASSWORD_DEFAULT);
        
        $pdo->exec("INSERT INTO `users` (`username`, `password`, `role`) VALUES ('admin', '$adminPassword', 'admin')");
        $pdo->exec("INSERT INTO `users` (`username`, `password`, `role`) VALUES ('user', '$userPassword', 'user')");
    }

    // Create table study_sessions if it doesn't exist
    $createTableQuery = "
        CREATE TABLE IF NOT EXISTS `study_sessions` (
            `id` VARCHAR(50) PRIMARY KEY,
            `subject` VARCHAR(255) NOT NULL,
            `start_time` DATETIME NOT NULL,
            `end_time` DATETIME NOT NULL,
            `duration_seconds` INT NOT NULL,
            `duration_minutes` INT NOT NULL,
            `concentration_level` INT DEFAULT NULL,
            `session_type` VARCHAR(20) DEFAULT 'study',
            `user_id` INT DEFAULT NULL,
            `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    ";
    $pdo->exec($createTableQuery);

    // Ensure session_type column exists for existing databases
    $columns = $pdo->query("SHOW COLUMNS FROM `study_sessions` LIKE 'session_type'")->fetchAll();
    if (empty($columns)) {
        $pdo->exec("ALTER TABLE `study_sessions` ADD COLUMN `session_type` VARCHAR(20) DEFAULT 'study'");
    }

    // Ensure user_id column exists for existing databases
    $userColumns = $pdo->query("SHOW COLUMNS FROM `study_sessions` LIKE 'user_id'")->fetchAll();
    if (empty($userColumns)) {
        $pdo->exec("ALTER TABLE `study_sessions` ADD COLUMN `user_id` INT DEFAULT NULL");
        $pdo->exec("ALTER TABLE `study_sessions` ADD CONSTRAINT `fk_study_sessions_users` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE");
    }

    // Assign orphaned sessions to the default user
    $defaultUserId = $pdo->query("SELECT id FROM `users` WHERE username = 'user'")->fetchColumn();
    if ($defaultUserId) {
        $pdo->exec("UPDATE `study_sessions` SET `user_id` = $defaultUserId WHERE `user_id` IS NULL");
    }

} catch (PDOException $e) {
    // Return connection error in JSON
    header('Content-Type: application/json');
    echo json_encode([
        'success' => false,
        'error' => 'Database connection failed: ' . $e->getMessage()
    ]);
    exit;
}
?>
