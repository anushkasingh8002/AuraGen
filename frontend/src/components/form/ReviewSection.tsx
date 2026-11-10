import { FormData } from '../../types/form.types'

interface Props {
  formData: FormData
  onAgreeToTerms: (val: boolean) => void
  onAgreeToCredit: (val: boolean) => void
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-2 border-b border-slate-100 last:border-0">
      <span className="text-sm text-slate-500">{label}</span>
      <span className="text-sm font-medium text-slate-800">{value || '—'}</span>
    </div>
  )
}

export default function ReviewSection({ formData, onAgreeToTerms, onAgreeToCredit }: Props) {
  const { personal, employment, loan } = formData

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="form-card">
        <h3 className="text-base font-semibold text-slate-800 mb-5">Application Summary</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Applicant</p>
            <Row label="Full Name"  value={`${personal.firstName} ${personal.lastName}`} />
            <Row label="Email"      value={personal.email} />
            <Row label="Phone"      value={personal.phone} />
            <Row label="Location"   value={`${personal.city}, ${personal.state} ${personal.zipCode}`} />
            <Row label="Dependents" value={personal.dependents || '0'} />
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Loan Request</p>
            <Row label="Loan Type"   value={loan.loanType} />
            <Row label="Amount"      value={loan.loanAmount ? `$${Number(loan.loanAmount).toLocaleString()}` : ''} />
            <Row label="Term"        value={loan.loanTerm ? `${loan.loanTerm} months` : ''} />
            <Row label="Employment"  value={employment.employmentStatus} />
            <Row label="Monthly Income" value={employment.monthlyIncome ? `$${Number(employment.monthlyIncome).toLocaleString()}` : ''} />
          </div>
        </div>
      </div>

      {/* Agreements */}
      <div className="form-card space-y-5">
        <h3 className="text-base font-semibold text-slate-800">Agreements & Authorizations</h3>

        <label className="flex items-start gap-3 cursor-pointer group">
          <input
            type="checkbox"
            checked={formData.agreeToTerms}
            onChange={(e) => onAgreeToTerms(e.target.checked)}
            className="mt-0.5 w-4 h-4 rounded border-slate-300 text-aura-600 focus:ring-aura-500"
          />
          <span className="text-sm text-slate-600 group-hover:text-slate-800 transition-colors leading-relaxed">
            I agree to the{' '}
            <span className="text-aura-600 underline cursor-pointer">Terms and Conditions</span> and{' '}
            <span className="text-aura-600 underline cursor-pointer">Privacy Policy</span>. I certify
            that all information provided in this application is true and accurate to the best of my
            knowledge.
          </span>
        </label>

        <label className="flex items-start gap-3 cursor-pointer group">
          <input
            type="checkbox"
            checked={formData.agreeToCredit}
            onChange={(e) => onAgreeToCredit(e.target.checked)}
            className="mt-0.5 w-4 h-4 rounded border-slate-300 text-aura-600 focus:ring-aura-500"
          />
          <span className="text-sm text-slate-600 group-hover:text-slate-800 transition-colors leading-relaxed">
            I authorize Infotact Financial to obtain a consumer credit report in connection with this
            loan application. I understand this may result in a hard inquiry on my credit report.
          </span>
        </label>
      </div>
    </div>
  )
}
