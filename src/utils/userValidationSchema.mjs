export const signUpSchema = {
  name: {
    isLength: {
      options: {min: 3, max: 24},
      errorMessage: 'Name cannot be less than 3 characters'
    }, 
    notEmpty :{
      errorMessage: 'Name cannot be left empty!'
    }, 
    isString : {
      errorMessage: 'Name must be a character'
    }
  },
  password: {
    isLength: {
      options: {min: 5, max: 24},
      errorMessage: 'Password is weak'
    }, 
    notEmpty: {
      errorMessage: 'Password cannot be left empty'
    }
  },
  email: {
    notEmpty: {
      errorMessage: 'Email cannot be left empty'
    },
    isString: {
      errorMessage: 'Email must be a character not numbers or special characters'
    }
  }
}

export const loginSchema = {
  email: {
    notEmpty: {
      errorMessage: "Email cannot be left empty",
    },
    isString: {
      errorMessage:
        "Email must be a character not numbers or special characters",
    },
  },
  password: {
    isLength: {
      options: { min: 5, max: 24 },
      errorMessage: "Password is weak",
    },
    notEmpty: {
      errorMessage: "Password cannot be left empty",
    }
  },
};