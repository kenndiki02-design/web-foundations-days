-- School database - Day 6 assignment (SQLite)

PRAGMA foreign_keys = ON;

-- Clean start so the script can be re-run in the playground.
DROP TABLE IF EXISTS enrolments;
DROP TABLE IF EXISTS courses;
DROP TABLE IF EXISTS students;

-- ---------------------------------------------------------------- Tables

CREATE TABLE students (
  id    INTEGER PRIMARY KEY,
  name  TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE
);

CREATE TABLE courses (
  id      INTEGER PRIMARY KEY,
  title   TEXT NOT NULL,
  credits INTEGER NOT NULL CHECK (credits > 0)
);

-- Join table: one row = one student enrolled on one course.
CREATE TABLE enrolments (
  id          INTEGER PRIMARY KEY,
  student_id  INTEGER NOT NULL,
  course_id   INTEGER NOT NULL,
  enrolled_on TEXT NOT NULL DEFAULT (date('now')),
  grade       INTEGER CHECK (grade BETWEEN 0 AND 100),  -- NULL until graded
  FOREIGN KEY (student_id) REFERENCES students (id),
  FOREIGN KEY (course_id)  REFERENCES courses (id),
  UNIQUE (student_id, course_id)  -- no enrolling on the same course twice
);

-- ---------------------------------------------------------------- Data

INSERT INTO students (id, name, email) VALUES
  (1, 'Amina Otieno',  'amina@example.com'),
  (2, 'Brian Kamau',   'brian@example.com'),
  (3, 'Grace Wanjiru', 'grace@example.com'),
  (4, 'David Mutua',   'david@example.com');   -- not enrolled yet

INSERT INTO courses (id, title, credits) VALUES
  (1, 'Web Foundations', 4),
  (2, 'Databases',       3),
  (3, 'Algorithms',      4);

INSERT INTO enrolments (student_id, course_id, grade) VALUES
  (1, 1, 85),
  (1, 2, 78),
  (2, 1, 64),
  (3, 1, NULL),
  (3, 2, 91),
  (3, 3, NULL);

-- ---------------------------------------------------------------- Queries

-- 1. All courses for one student (by name).
SELECT c.title, c.credits, e.grade
FROM students s
JOIN enrolments e ON e.student_id = s.id
JOIN courses c    ON c.id = e.course_id
WHERE s.name = 'Amina Otieno';
-- Expected: Web Foundations (4, 85) and Databases (3, 78)

-- 2. All students on one course.
SELECT s.name, s.email, e.grade
FROM courses c
JOIN enrolments e ON e.course_id = c.id
JOIN students s   ON s.id = e.student_id
WHERE c.title = 'Web Foundations';
-- Expected: Amina Otieno, Brian Kamau, Grace Wanjiru

-- 3. Number of students per course (LEFT JOIN keeps courses with 0 students).
SELECT c.title, COUNT(e.id) AS student_count
FROM courses c
LEFT JOIN enrolments e ON e.course_id = c.id
GROUP BY c.id, c.title
ORDER BY student_count DESC;
-- Expected: Web Foundations 3, Databases 2, Algorithms 1

-- 4. Students who have no enrolments.
SELECT s.name, s.email
FROM students s
LEFT JOIN enrolments e ON e.student_id = s.id
WHERE e.id IS NULL;
-- Expected: David Mutua

-- 5. Update one enrolment's grade (Grace's grade for Web Foundations).
UPDATE enrolments
SET grade = 88
WHERE student_id = (SELECT id FROM students WHERE email = 'grace@example.com')
  AND course_id  = (SELECT id FROM courses  WHERE title = 'Web Foundations');

-- Check the update worked.
SELECT s.name, c.title, e.grade
FROM enrolments e
JOIN students s ON s.id = e.student_id
JOIN courses c  ON c.id = e.course_id
WHERE s.email = 'grace@example.com' AND c.title = 'Web Foundations';
-- Expected: Grace Wanjiru, Web Foundations, 88