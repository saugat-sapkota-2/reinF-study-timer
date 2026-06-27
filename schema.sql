--
-- Database Schema for reinF Study Time Tracker
--

CREATE DATABASE IF NOT EXISTS `study_tracker` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `study_tracker`;

-- --------------------------------------------------------

--
-- Table structure for table `users`
--

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

--
-- Table structure for table `study_sessions`
--

CREATE TABLE IF NOT EXISTS `study_sessions` (
  `id` VARCHAR(50) NOT NULL,
  `subject` VARCHAR(255) NOT NULL,
  `start_time` DATETIME NOT NULL,
  `end_time` DATETIME NOT NULL,
  `duration_seconds` INT NOT NULL,
  `duration_minutes` INT NOT NULL,  
  `concentration_level` INT DEFAULT NULL,
  `session_type` VARCHAR(20) DEFAULT 'study',
  `user_id` INT DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
