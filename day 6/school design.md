# School Database Design

## Tables

### `students`
- Stores one row per student: `id` (primary key), `name` and `email`.
- `name` and `email` are `NOT NULL`, and `email` is `UNIQUE` so two students cannot share an address.

### `courses`
- Stores one row per course: `id` (primary key), `title` and `credits`.
- `credits` must be greater than 0.

### `enrolments`
- Stores one row for each time a student enrols on a course: `id` (primary key), `student_id`, `course_id`, `enrolled_on` and `grade`.
- `student_id` and `course_id` are foreign keys pointing at `students` and `courses`.
- `grade` is allowed to be `NULL` because a student has no grade until the work is marked.
- `UNIQUE (student_id, course_id)` stops the same student enrolling on the same course twice.

## Relationships

- **One-to-many:** one student has many enrolments, and one course has many enrolments. Each enrolment row belongs to exactly one student and exactly one course.
- **Many-to-many:** students and courses. A student can take many courses and a course has many students.
- **Why a join table is needed:** a relational table cannot store a list in one column. Putting `course_id` on `students` would allow only one course per student, and putting `student_id` on `courses` would allow only one student per course. The `enrolments` table turns the many-to-many relationship into two one-to-many relationships. It is also the natural place for facts about the pairing itself, such as the grade and the enrolment date.

## Index I would add

```sql
CREATE INDEX idx_enrolments_course_id ON enrolments (course_id);
```

- The `UNIQUE (student_id, course_id)` rule already creates an index that speeds up searches starting from a student.
- Searches that start from a course, such as "all students on this course" or "number of students per course", cannot use that index efficiently, because `course_id` is its second column.
- An index on `course_id` lets the database jump straight to the matching enrolments instead of scanning the whole table. This matters as the number of enrolments grows.

## SQL or NoSQL?

I would choose SQL for this system. The data is highly structured and relational: students, courses and enrolments always have the same fields and link to each other in a clear many-to-many pattern. A SQL database enforces the rules I need directly in the schema, including unique emails, foreign keys that stop an enrolment pointing at a student who does not exist, and the ban on duplicate enrolments. It also makes the questions a school asks easy to answer with joins and aggregates, such as class lists, students per course and students with no enrolments. A NoSQL document store would be a good fit if the data were loosely structured, changed shape often or had to scale across many servers, but none of that is true here. Using NoSQL would mean duplicating data between documents and enforcing these rules in application code, which is more work and easier to get wrong.