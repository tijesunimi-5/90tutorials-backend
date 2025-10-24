/**
 * Maps PostgreSQL SQLSTATE error codes to user-friendly messages.
 * @param {object} error - The error object returned by the database client.
 * @returns {string} - A user-friendly error message.
 */
export function errorHandler(error) {
  switch (error.code) {
    // 23503: foreign_key_violation
    case "23503":
      // This happens if the category_id does not exist in the categories table.
      return "Cannot create exam. The selected exam category does not exist.";

    // 23502: not_null_violation
    case "23502":
      // Though covered by our initial validation, this handles DB-level NOT NULL errors.
      return "A required field was left empty. Please check your inputs.";

    // 22001: string_data_right_truncation (if title is too long for VARCHAR(255))
    case "22001":
      return "The exam title or other text is too long. Please shorten it.";

    // 22P02: invalid_text_representation (e.g., passing 'abc' to an INT field like duration_minutes)
    case "22P02":
      return "Please ensure all duration and ID fields contain valid numbers.";

    // Default catch-all for unexpected database issues
    default:
      return "An unexpected error occurred while saving the exam. Please try again or contact support.";
  }
}
