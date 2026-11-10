import { FormData } from '../../types/form.types'
import { InputField, FormSection } from '../ui'

interface Props {
  data: FormData['assets']
  errors: Record<string, string>
  onChange: (field: keyof FormData['assets'], value: string) => void
}

export default function AssetsLiabilitiesSection({ data, onChange }: Props) {
  const toNum = (v: string) => parseFloat(v) || 0

  const totalAssets =
    toNum(data.checkingBalance) + toNum(data.savingsBalance) +
    toNum(data.investmentValue) + toNum(data.propertyValue) + toNum(data.vehicleValue)

  const totalLiabilities =
    toNum(data.creditCardDebt) + toNum(data.studentLoanDebt) +
    toNum(data.mortgageBalance) + toNum(data.otherLiabilities)

  const netWorth = totalAssets - totalLiabilities

  return (
    <>
      <FormSection title="Assets" description="Current estimated value of what you own" icon="📈">
        <InputField
          label="Checking Account Balance ($)" type="number" value={data.checkingBalance}
          onChange={(e) => onChange('checkingBalance', e.target.value)} placeholder="2000"
        />
        <InputField
          label="Savings Account Balance ($)" type="number" value={data.savingsBalance}
          onChange={(e) => onChange('savingsBalance', e.target.value)} placeholder="10000"
        />
        <InputField
          label="Investment Portfolio Value ($)" type="number" value={data.investmentValue}
          onChange={(e) => onChange('investmentValue', e.target.value)} placeholder="0"
          hint="Stocks, bonds, 401k, IRA, etc."
        />
        <InputField
          label="Real Estate Value ($)" type="number" value={data.propertyValue}
          onChange={(e) => onChange('propertyValue', e.target.value)} placeholder="0"
        />
        <InputField
          label="Vehicle Value ($)" type="number" value={data.vehicleValue}
          onChange={(e) => onChange('vehicleValue', e.target.value)} placeholder="0"
        />
        <div className="md:col-span-2 p-3 bg-emerald-50 rounded-xl border border-emerald-200">
          <span className="text-sm font-medium text-emerald-700">Total Assets: </span>
          <span className="text-sm font-bold text-emerald-800">
            ${totalAssets.toLocaleString()}
          </span>
        </div>
      </FormSection>

      <FormSection title="Liabilities" description="Your current outstanding debts and obligations" icon="📉">
        <InputField
          label="Credit Card Debt ($)" type="number" value={data.creditCardDebt}
          onChange={(e) => onChange('creditCardDebt', e.target.value)} placeholder="0"
        />
        <InputField
          label="Student Loan Balance ($)" type="number" value={data.studentLoanDebt}
          onChange={(e) => onChange('studentLoanDebt', e.target.value)} placeholder="0"
        />
        <InputField
          label="Mortgage Balance ($)" type="number" value={data.mortgageBalance}
          onChange={(e) => onChange('mortgageBalance', e.target.value)} placeholder="0"
        />
        <InputField
          label="Other Liabilities ($)" type="number" value={data.otherLiabilities}
          onChange={(e) => onChange('otherLiabilities', e.target.value)} placeholder="0"
        />
        <div className="md:col-span-2 grid grid-cols-2 gap-3">
          <div className="p-3 bg-red-50 rounded-xl border border-red-200">
            <span className="text-sm font-medium text-red-700">Total Liabilities: </span>
            <span className="text-sm font-bold text-red-800">
              ${totalLiabilities.toLocaleString()}
            </span>
          </div>
          <div
            className={`p-3 rounded-xl border ${
              netWorth >= 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'
            }`}
          >
            <span
              className={`text-sm font-medium ${netWorth >= 0 ? 'text-emerald-700' : 'text-red-700'}`}
            >
              Net Worth:{' '}
            </span>
            <span
              className={`text-sm font-bold ${netWorth >= 0 ? 'text-emerald-800' : 'text-red-800'}`}
            >
              ${netWorth.toLocaleString()}
            </span>
          </div>
        </div>
      </FormSection>
    </>
  )
}
