import { FormStateReturn } from '../../hooks/useFormState'
import { StepIndicator, Button } from '../ui'
import PersonalInfoSection      from './PersonalInfoSection'
import EmploymentSection        from './EmploymentSection'
import LoanDetailsSection       from './LoanDetailsSection'
import AssetsLiabilitiesSection from './AssetsLiabilitiesSection'
import ReviewSection            from './ReviewSection'

const STEPS = [
  { id: 1, label: 'Personal' },
  { id: 2, label: 'Employment' },
  { id: 3, label: 'Loan Details' },
  { id: 4, label: 'Assets' },
  { id: 5, label: 'Review' },
]

type Props = FormStateReturn

export default function LoanApplicationForm({
  formData, errors, currentStep,
  updateField, updateTopLevel,
  nextStep, prevStep, goToStep,
}: Props) {
  const steps = STEPS.map((s) => ({
    ...s,
    completed: s.id < currentStep,
    active:    s.id === currentStep,
  }))

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800">Loan Application</h1>
        <p className="text-slate-500 mt-1 text-sm">
          Complete all sections to submit your application
        </p>
      </div>

      <StepIndicator steps={steps} onStepClick={goToStep} />

      <div className="min-h-[400px]">
        {currentStep === 1 && (
          <PersonalInfoSection
            data={formData.personal} errors={errors}
            onChange={(field, value) => updateField('personal', field, value)}
          />
        )}
        {currentStep === 2 && (
          <EmploymentSection
            data={formData.employment} errors={errors}
            onChange={(field, value) => updateField('employment', field, value)}
          />
        )}
        {currentStep === 3 && (
          <LoanDetailsSection
            data={formData.loan} errors={errors}
            onChange={(field, value) => updateField('loan', field, value)}
          />
        )}
        {currentStep === 4 && (
          <AssetsLiabilitiesSection
            data={formData.assets} errors={errors}
            onChange={(field, value) => updateField('assets', field, value)}
          />
        )}
        {currentStep === 5 && (
          <ReviewSection
            formData={formData}
            onAgreeToTerms={(val)  => updateTopLevel('agreeToTerms', val)}
            onAgreeToCredit={(val) => updateTopLevel('agreeToCredit', val)}
          />
        )}
      </div>

      <div className="flex justify-between mt-6">
        <Button variant="secondary" onClick={prevStep} disabled={currentStep === 1}>
          ← Previous
        </Button>
        {currentStep < 5 ? (
          <Button onClick={nextStep}>Continue →</Button>
        ) : (
          <Button
            onClick={() => alert('Application submitted! (Backend integration in Week 2)')}
            disabled={!formData.agreeToTerms || !formData.agreeToCredit}
          >
            Submit Application ✓
          </Button>
        )}
      </div>
    </div>
  )
}
