export const examSchema = {
  title: {
    isLength: {
      options: { min: 3, max: 50 },
      errorMessage: "Title must be between 3 and 50 characters",
    },
    notEmpty: {
      errorMessage: "Title cannot be empty",
    },
    isString: {
      errorMessage: "Title must be a string",
    },
  },
  subjects: {
    isArray: {
      options: { min: 1 },
      errorMessage: "Subjects must be a non-empty array",
    },
    custom: {
      options: (subjects) =>
        subjects.every(
          (subject) =>
            typeof subject === "object" &&
            subject.title &&
            typeof subject.title === "string" &&
            subject.title.length >= 3 &&
            subject.title.length <= 50 &&
            Array.isArray(subject.questions) &&
            subject.questions.length > 0 &&
            subject.questions.every(
              (question) =>
                typeof question === "object" &&
                question.text &&
                typeof question.text === "string" &&
                question.text.length >= 1 &&
                Array.isArray(question.options) &&
                question.options.length > 0 &&
                question.options.every((opt) => typeof opt === "string") &&
                question.answer &&
                typeof question.answer === "string" &&
                question.options.includes(question.answer) &&
                question.optionType &&
                question.optionType === "checkbox"
            )
        ),
      errorMessage:
        "Each subject must have a title (3-50 chars) and at least one question with valid text, options (non-empty array of strings), answer (one of the options), and optionType (checkbox)",
    },
  },
};

export const updateExamSchema = {
  title: {
    optional: true,
    isLength: {
      options: { min: 3, max: 50 },
      errorMessage: "Title must be between 3 and 50 characters",
    },
    isString: {
      errorMessage: "Title must be a string",
    },
  },
  subjects: {
    optional: true,
    isArray: true,
    custom: {
      options: (subjects) =>
        subjects.every(
          (subject) =>
            typeof subject === "object" &&
            subject.title &&
            typeof subject.title === "string"
        ),
      errorMessage:
        "Each subject must at least have a valid title. Questions are optional when updating.",
    },
  },
  "": {
    custom: {
      options: (value, { req }) => {
        return !!(req.body.title || req.body.subjects);
      },
      errorMessage: "At least one field (title or subjects) must be provided",
    },
  },
};
