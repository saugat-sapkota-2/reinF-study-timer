<?php
session_start();
header('Content-Type: application/json');
require_once 'db.php'; // sets $pdo

$method = $_SERVER['REQUEST_METHOD'];

// Helper to check if user is logged in
function isLoggedIn() {
    return isset($_SESSION['user_id']);
}

// Helper to check if user is admin
function isAdmin() {
    return isset($_SESSION['role']) && $_SESSION['role'] === 'admin';
}

// Helper to get raw JSON inputs
function getJsonInput() {
    $rawInput = file_get_contents('php://input');
    $input = json_decode($rawInput, true);
    return $input ?: $_POST;
}

// Auto update last seen for logged in users
if (isLoggedIn()) {
    try {
        $stmt = $pdo->prepare("UPDATE users SET last_seen = NOW() WHERE id = :id");
        $stmt->execute(['id' => $_SESSION['user_id']]);
    } catch (PDOException $e) {
        // Ignore silent database errors
    }
}

if ($method === 'GET') {
    $action = isset($_GET['action']) ? $_GET['action'] : '';

    // Check if user is logged in
    if ($action === 'me') {
        if (isLoggedIn()) {
            echo json_encode([
                'success' => true,
                'user' => [
                    'id' => $_SESSION['user_id'],
                    'username' => $_SESSION['username'],
                    'role' => $_SESSION['role']
                ]
            ]);
        } else {
            echo json_encode([
                'success' => false,
                'error' => 'Not authenticated'
            ]);
        }
        exit;
    }

    if ($action === 'logout') {
        session_destroy();
        echo json_encode(['success' => true]);
        exit;
    }

    // Authenticated GET actions
    if (!isLoggedIn()) {
        http_response_code(401);
        echo json_encode(['success' => false, 'error' => 'Unauthorized']);
        exit;
    }

    if ($action === 'admin_users') {
        if (!isAdmin()) {
            http_response_code(403);
            echo json_encode(['success' => false, 'error' => 'Forbidden']);
            exit;
        }
        try {
            $stmt = $pdo->query("
                SELECT u.id, u.username, u.role, u.created_at, u.last_seen, u.timer_status, u.timer_subject,
                       COUNT(s.id) as total_sessions, 
                       COALESCE(SUM(s.duration_seconds), 0) as total_duration 
                FROM users u 
                LEFT JOIN study_sessions s ON u.id = s.user_id 
                GROUP BY u.id, u.username, u.role, u.created_at, u.last_seen, u.timer_status, u.timer_subject
                ORDER BY u.username ASC
            ");
            $users = $stmt->fetchAll(PDO::FETCH_ASSOC);
            
            // Append online state
            foreach ($users as &$u) {
                $last_seen_time = $u['last_seen'] ? strtotime($u['last_seen']) : 0;
                $u['is_online'] = (time() - $last_seen_time) < 25;
            }
            
            echo json_encode([
                'success' => true,
                'users' => $users
            ]);
        } catch (PDOException $e) {
            echo json_encode(['success' => false, 'error' => $e->getMessage()]);
        }
        exit;
    }

    if ($action === 'user_timer_status') {
        if (!isAdmin()) {
            http_response_code(403);
            echo json_encode(['success' => false, 'error' => 'Forbidden']);
            exit;
        }
        $targetUserId = intval($_GET['user_id'] ?? 0);
        if (!$targetUserId) {
            echo json_encode(['success' => false, 'error' => 'Missing target user ID']);
            exit;
        }
        try {
            $stmt = $pdo->prepare("SELECT id, username, last_seen, timer_status, timer_subject, timer_started_at FROM users WHERE id = :id");
            $stmt->execute(['id' => $targetUserId]);
            $u = $stmt->fetch(PDO::FETCH_ASSOC);
            if ($u) {
                $last_seen_time = $u['last_seen'] ? strtotime($u['last_seen']) : 0;
                $u['is_online'] = (time() - $last_seen_time) < 25;
                echo json_encode([
                    'success' => true,
                    'user_timer' => $u
                ]);
            } else {
                echo json_encode(['success' => false, 'error' => 'User not found']);
            }
        } catch (PDOException $e) {
            echo json_encode(['success' => false, 'error' => $e->getMessage()]);
        }
        exit;
    }

    // Default GET: Fetch all sessions for a user
    try {
        $userId = $_SESSION['user_id'];
        
        // Admin can inspect other users
        if (isAdmin() && isset($_GET['inspect_user_id']) && $_GET['inspect_user_id'] !== '') {
            $userId = intval($_GET['inspect_user_id']);
        }

        $stmt = $pdo->prepare("SELECT * FROM study_sessions WHERE user_id = :user_id ORDER BY start_time DESC");
        $stmt->execute(['user_id' => $userId]);
        $sessions = $stmt->fetchAll(PDO::FETCH_ASSOC);
        echo json_encode([
            'success' => true,
            'sessions' => $sessions
        ]);
    } catch (PDOException $e) {
        echo json_encode([
            'success' => false,
            'error' => $e->getMessage()
        ]);
    }
    exit;
}

if ($method === 'POST') {
    $input = getJsonInput();
    $action = isset($input['action']) ? $input['action'] : '';

    // Public POST actions
    if ($action === 'login') {
        $username = trim($input['username'] ?? '');
        $password = $input['password'] ?? '';

        if (!$username || !$password) {
            echo json_encode(['success' => false, 'error' => 'Username and password are required']);
            exit;
        }

        try {
            $stmt = $pdo->prepare("SELECT * FROM users WHERE username = :username");
            $stmt->execute(['username' => $username]);
            $user = $stmt->fetch(PDO::FETCH_ASSOC);

            if ($user && password_verify($password, $user['password'])) {
                $_SESSION['user_id'] = $user['id'];
                $_SESSION['username'] = $user['username'];
                $_SESSION['role'] = $user['role'];

                echo json_encode([
                    'success' => true,
                    'user' => [
                        'id' => $user['id'],
                        'username' => $user['username'],
                        'role' => $user['role']
                    ]
                ]);
            } else {
                echo json_encode(['success' => false, 'error' => 'Invalid username or password']);
            }
        } catch (PDOException $e) {
            echo json_encode(['success' => false, 'error' => $e->getMessage()]);
        }
        exit;
    }

    if ($action === 'register') {
        $username = trim($input['username'] ?? '');
        $password = $input['password'] ?? '';

        if (!$username || !$password) {
            echo json_encode(['success' => false, 'error' => 'Username and password are required']);
            exit;
        }

        if (strlen($username) < 3 || strlen($password) < 4) {
            echo json_encode(['success' => false, 'error' => 'Username must be at least 3 chars & Password at least 4 chars']);
            exit;
        }

        try {
            $stmt = $pdo->prepare("SELECT COUNT(*) FROM users WHERE username = :username");
            $stmt->execute(['username' => $username]);
            if ($stmt->fetchColumn() > 0) {
                echo json_encode(['success' => false, 'error' => 'Username is already taken']);
                exit;
            }

            $hashedPassword = password_hash($password, PASSWORD_DEFAULT);
            $stmt = $pdo->prepare("INSERT INTO users (username, password, role) VALUES (:username, :password, 'user')");
            $stmt->execute([
                'username' => $username,
                'password' => $hashedPassword
            ]);

            $newUserId = $pdo->lastInsertId();

            $_SESSION['user_id'] = $newUserId;
            $_SESSION['username'] = $username;
            $_SESSION['role'] = 'user';

            echo json_encode([
                'success' => true,
                'user' => [
                    'id' => $newUserId,
                    'username' => $username,
                    'role' => 'user'
                ]
            ]);
        } catch (PDOException $e) {
            echo json_encode(['success' => false, 'error' => $e->getMessage()]);
        }
        exit;
    }

    // Authenticated POST actions
    if (!isLoggedIn()) {
        http_response_code(401);
        echo json_encode(['success' => false, 'error' => 'Unauthorized']);
        exit;
    }

    // Heartbeat to update status and activity
    if ($action === 'heartbeat') {
        $status = $input['timer_status'] ?? 'idle';
        $subject = $input['timer_subject'] ?? null;
        $started_at = $input['timer_started_at'] ?? null;
        
        try {
            $stmt = $pdo->prepare("
                UPDATE users 
                SET last_seen = NOW(), 
                    timer_status = :status, 
                    timer_subject = :subject, 
                    timer_started_at = :started_at 
                WHERE id = :id
            ");
            $stmt->execute([
                'status' => $status,
                'subject' => $subject,
                'started_at' => $started_at,
                'id' => $_SESSION['user_id']
            ]);
            echo json_encode(['success' => true]);
        } catch (PDOException $e) {
            echo json_encode(['success' => false, 'error' => $e->getMessage()]);
        }
        exit;
    }

    // ADMIN ONLY user management actions
    if ($action === 'admin_create_user') {
        if (!isAdmin()) {
            http_response_code(403);
            echo json_encode(['success' => false, 'error' => 'Forbidden']);
            exit;
        }
        $username = trim($input['username'] ?? '');
        $password = $input['password'] ?? '';
        $role = $input['role'] ?? 'user';

        if (!$username || !$password) {
            echo json_encode(['success' => false, 'error' => 'Username and password are required']);
            exit;
        }

        try {
            $stmt = $pdo->prepare("SELECT COUNT(*) FROM users WHERE username = :username");
            $stmt->execute(['username' => $username]);
            if ($stmt->fetchColumn() > 0) {
                echo json_encode(['success' => false, 'error' => 'Username already exists']);
                exit;
            }

            $hashedPassword = password_hash($password, PASSWORD_DEFAULT);
            $stmt = $pdo->prepare("INSERT INTO users (username, password, role) VALUES (:username, :password, :role)");
            $stmt->execute([
                'username' => $username,
                'password' => $hashedPassword,
                'role' => $role
            ]);
            echo json_encode(['success' => true]);
        } catch (PDOException $e) {
            echo json_encode(['success' => false, 'error' => $e->getMessage()]);
        }
        exit;
    }

    if ($action === 'admin_update_user') {
        if (!isAdmin()) {
            http_response_code(403);
            echo json_encode(['success' => false, 'error' => 'Forbidden']);
            exit;
        }
        $targetUserId = intval($input['user_id'] ?? 0);
        $username = trim($input['username'] ?? '');
        $password = $input['password'] ?? '';
        $role = $input['role'] ?? '';

        if (!$targetUserId) {
            echo json_encode(['success' => false, 'error' => 'Missing target user ID']);
            exit;
        }

        try {
            // Check if username is being changed and is already taken
            if ($username !== '') {
                $stmt = $pdo->prepare("SELECT COUNT(*) FROM users WHERE username = :username AND id != :id");
                $stmt->execute(['username' => $username, 'id' => $targetUserId]);
                if ($stmt->fetchColumn() > 0) {
                    echo json_encode(['success' => false, 'error' => 'Username already taken']);
                    exit;
                }
            }

            // Perform dynamic update
            $updates = [];
            $params = ['id' => $targetUserId];

            if ($username !== '') {
                $updates[] = "username = :username";
                $params['username'] = $username;
            }
            if ($role !== '') {
                // Ensure they don't demote themselves if they are the only admin, but for simplicity let admin set role
                $updates[] = "role = :role";
                $params['role'] = $role;
            }
            if ($password !== '') {
                $updates[] = "password = :password";
                $params['password'] = password_hash($password, PASSWORD_DEFAULT);
            }

            if (empty($updates)) {
                echo json_encode(['success' => false, 'error' => 'Nothing to update']);
                exit;
            }

            $sql = "UPDATE users SET " . implode(", ", $updates) . " WHERE id = :id";
            $stmt = $pdo->prepare($sql);
            $stmt->execute($params);

            // If updated own profile, update session
            if ($targetUserId === $_SESSION['user_id']) {
                if ($username !== '') $_SESSION['username'] = $username;
                if ($role !== '') $_SESSION['role'] = $role;
            }

            echo json_encode(['success' => true]);
        } catch (PDOException $e) {
            echo json_encode(['success' => false, 'error' => $e->getMessage()]);
        }
        exit;
    }

    if ($action === 'admin_delete_user') {
        if (!isAdmin()) {
            http_response_code(403);
            echo json_encode(['success' => false, 'error' => 'Forbidden']);
            exit;
        }
        $targetUserId = intval($input['user_id'] ?? 0);

        if (!$targetUserId) {
            echo json_encode(['success' => false, 'error' => 'Missing target user ID']);
            exit;
        }

        if ($targetUserId === $_SESSION['user_id']) {
            echo json_encode(['success' => false, 'error' => 'You cannot delete your own admin account']);
            exit;
        }

        try {
            $stmt = $pdo->prepare("DELETE FROM users WHERE id = :id");
            $stmt->execute(['id' => $targetUserId]);
            echo json_encode(['success' => true]);
        } catch (PDOException $e) {
            echo json_encode(['success' => false, 'error' => $e->getMessage()]);
        }
        exit;
    }

    // STUDY SESSION OPERATIONS
    if ($action === 'save') {
        $id = $input['id'] ?? '';
        $subject = $input['subject'] ?? 'Unspecified';
        $start_time = $input['start_time'] ?? '';
        $end_time = $input['end_time'] ?? '';
        $duration_seconds = intval($input['duration_seconds'] ?? 0);
        $duration_minutes = intval($input['duration_minutes'] ?? 0);
        $concentration_level = isset($input['concentration_level']) && $input['concentration_level'] !== null && $input['concentration_level'] !== '' 
            ? intval($input['concentration_level']) 
            : null;
        $session_type = $input['session_type'] ?? 'study';

        // Set appropriate user scope
        $userId = $_SESSION['user_id'];
        if (isAdmin() && isset($input['inspect_user_id']) && $input['inspect_user_id'] !== '') {
            $userId = intval($input['inspect_user_id']);
        }

        if (!$id || !$start_time || !$end_time) {
            echo json_encode([
                'success' => false,
                'error' => 'Missing required fields: id, start_time, end_time'
            ]);
            exit;
        }

        try {
            // First check if modifying existing session and if it belongs to this user
            $stmt = $pdo->prepare("SELECT user_id FROM study_sessions WHERE id = :id");
            $stmt->execute(['id' => $id]);
            $existingUserId = $stmt->fetchColumn();

            if ($existingUserId !== false && intval($existingUserId) !== intval($userId)) {
                // Not the owner!
                echo json_encode(['success' => false, 'error' => 'Unauthorized to modify this session']);
                exit;
            }

            $stmt = $pdo->prepare("
                INSERT INTO study_sessions (id, subject, start_time, end_time, duration_seconds, duration_minutes, concentration_level, session_type, user_id) 
                VALUES (:id, :subject, :start_time, :end_time, :duration_seconds, :duration_minutes, :concentration_level, :session_type, :user_id)
                ON DUPLICATE KEY UPDATE 
                    subject = :subject,
                    start_time = :start_time,
                    end_time = :end_time,
                    duration_seconds = :duration_seconds,
                    duration_minutes = :duration_minutes,
                    concentration_level = :concentration_level,
                    session_type = :session_type,
                    user_id = :user_id
            ");
            $stmt->execute([
                'id' => $id,
                'subject' => $subject,
                'start_time' => $start_time,
                'end_time' => $end_time,
                'duration_seconds' => $duration_seconds,
                'duration_minutes' => $duration_minutes,
                'concentration_level' => $concentration_level,
                'session_type' => $session_type,
                'user_id' => $userId
            ]);
            echo json_encode(['success' => true]);
        } catch (PDOException $e) {
            echo json_encode(['success' => false, 'error' => $e->getMessage()]);
        }
        exit;
    }

    if ($action === 'delete') {
        $id = $input['id'] ?? '';
        if (!$id) {
            echo json_encode(['success' => false, 'error' => 'Missing ID for deletion']);
            exit;
        }

        // Set appropriate user scope
        $userId = $_SESSION['user_id'];
        if (isAdmin() && isset($input['inspect_user_id']) && $input['inspect_user_id'] !== '') {
            $userId = intval($input['inspect_user_id']);
        }

        try {
            // Verify session belongs to user or we are admin
            if (isAdmin()) {
                $stmt = $pdo->prepare("DELETE FROM study_sessions WHERE id = :id");
                $stmt->execute(['id' => $id]);
            } else {
                $stmt = $pdo->prepare("DELETE FROM study_sessions WHERE id = :id AND user_id = :user_id");
                $stmt->execute(['id' => $id, 'user_id' => $userId]);
            }
            echo json_encode(['success' => true]);
        } catch (PDOException $e) {
            echo json_encode(['success' => false, 'error' => $e->getMessage()]);
        }
        exit;
    }

    if ($action === 'clear') {
        $session_type = $input['session_type'] ?? 'study';
        
        // Set appropriate user scope
        $userId = $_SESSION['user_id'];
        if (isAdmin() && isset($input['inspect_user_id']) && $input['inspect_user_id'] !== '') {
            $userId = intval($input['inspect_user_id']);
        }

        try {
            $stmt = $pdo->prepare("DELETE FROM study_sessions WHERE session_type = :session_type AND user_id = :user_id");
            $stmt->execute(['session_type' => $session_type, 'user_id' => $userId]);
            echo json_encode(['success' => true]);
        } catch (PDOException $e) {
            echo json_encode(['success' => false, 'error' => $e->getMessage()]);
        }
        exit;
    }

    echo json_encode(['success' => false, 'error' => 'Unknown POST action']);
    exit;
}

echo json_encode(['success' => false, 'error' => 'Unsupported request method']);
?>
