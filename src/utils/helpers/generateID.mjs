// generateID.mjs (Revised)

// Note: Removed the generateSequentialString function entirely.

/**
 * Generates a random numeric ID of a specific length.
 * @param {number} length - The desired length of the ID.
 * @returns {number} The generated numeric ID.
 */
export function generateID(length) {
  const min = Math.pow(10, length - 1);
  const max = Math.pow(10, length) - 1;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Generates a random string ID with a prefix and year.
 * @param {string} prefix - The prefix for the ID.
 * @param {number} length - The length of the random numeric part.
 * @returns {string} The generated random string ID.
 */
export function generateRandomString(prefix, length) {
  const year = new Date().getFullYear().toString().slice(2);
  const chars = "0123456789";
  let str = `${prefix}/${year}/`;
  for (let i = 0; i < length; i++) {
    str += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return str;
}

/**
 * Constructs the final student ID code string for display.
 * @param {string} uniqueId - The unique ID prefix (e.g., 'UI/PM').
 * @param {number} sequentialNum - The unique sequence number (e.g., 1, 10, 100).
 * @param {number} length - The desired padding length for the sequence number (e.g., 4 for '0001').
 * @returns {string} The fully constructed ID string (e.g., 'UI/PM/25/0001').
 */
export function constructStudentIdCode(uniqueId, sequentialNum, length = 4) {
  const year = new Date().getFullYear().toString().slice(2);
  const paddedNum = String(sequentialNum).padStart(length, "0");
  return `${uniqueId}/${year}/${paddedNum}`;
}

// --- Helper Functions (Logic remains the same) ---

export function generateSequentialID(filteredExam, subject) {
  const currentID = filteredExam.subjects.find(
    (sub) => sub.name.toLowerCase() === subject.toLowerCase()
  ).questions.length;

  const nextID = currentID ? currentID + 1 : 1;

  return nextID;
}

export function regenerateSequentialID(length) {
  const nextID = length + 1;
  return nextID;
}

export function generateAlphabetID(index) {
  const quotient = Math.floor(index / 26);
  const remainder = index % 26;
  if (quotient === 0) {
    return String.fromCharCode(65 + remainder);
  } else {
    return (
      String.fromCharCode(65 + quotient - 1) +
      String.fromCharCode(65 + remainder)
    );
  }
}
