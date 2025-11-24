import pool from "./db.mjs";

export async function updateAuthorizedExamId(examTitle, newUniqueId) {
  const query = `
        UPDATE exams_authorized
        SET unique_id = $1
        WHERE exam_title = $2
        RETURNING *;
    `;
  // Note: Since 'unique_id' is used to construct the student display ID on the fly,
  // updating this column is sufficient. The internal sequence name remains unchanged.
  const { rows } = await pool.query(query, [newUniqueId, examTitle]);
  return rows[0];
}

export async function fetchAllAuthorizedExamsData() {
  const query = `SELECT unique_id, exam_title FROM exams_authorized`;
  const { rows } = await pool.query(query);
  // Return { title: 'Exam Name', uniqueId: 'ID/PM' }
  return rows.map((row) => ({
    title: row.exam_title,
    uniqueId: row.unique_id,
  }));
}