export interface PersonalInfo {
  firstName: string
  lastName: string
  dateOfBirth: string
  ssn: string
  email: string
  phone: string
  address: string
  city: string
  state: string
  zipCode: string
  maritalStatus: string
  dependents: string
}

export interface EmploymentInfo {
  employmentStatus: string
  employerName: string
  jobTitle: string
  yearsEmployed: string
  monthlyIncome: string
  otherIncome: string
  otherIncomeSource: string
}

export interface LoanDetails {
  loanType: string
  loanAmount: string
  loanTerm: string
  purpose: string
  collateral: string
  collateralValue: string
  existingDebts: string
}

export interface AssetsLiabilities {
  checkingBalance: string
  savingsBalance: string
  investmentValue: string
  propertyValue: string
  vehicleValue: string
  creditCardDebt: string
  studentLoanDebt: string
  mortgageBalance: string
  otherLiabilities: string
}

export interface FormData {
  personal: PersonalInfo
  employment: EmploymentInfo
  loan: LoanDetails
  assets: AssetsLiabilities
  agreeToTerms: boolean
  agreeToCredit: boolean
}

export const initialFormData: FormData = {
  personal: {
    firstName: '', lastName: '', dateOfBirth: '', ssn: '',
    email: '', phone: '', address: '', city: '', state: '',
    zipCode: '', maritalStatus: '', dependents: '',
  },
  employment: {
    employmentStatus: '', employerName: '', jobTitle: '',
    yearsEmployed: '', monthlyIncome: '', otherIncome: '', otherIncomeSource: '',
  },
  loan: {
    loanType: '', loanAmount: '', loanTerm: '', purpose: '',
    collateral: '', collateralValue: '', existingDebts: '',
  },
  assets: {
    checkingBalance: '', savingsBalance: '', investmentValue: '',
    propertyValue: '', vehicleValue: '', creditCardDebt: '',
    studentLoanDebt: '', mortgageBalance: '', otherLiabilities: '',
  },
  agreeToTerms: false,
  agreeToCredit: false,
}
