const fs = require('node:fs')
const path = require('node:path')
const Ajv2020 = require('ajv/dist/2020')
const addFormats = require('ajv-formats')

const rootDir = path.resolve(__dirname, '..')

const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
})
addFormats(ajv)

function readJsonFile(filePath) {
  const fullPath = path.resolve(rootDir, filePath)
  try {
    const content = fs.readFileSync(fullPath, 'utf8')
    return JSON.parse(content)
  } catch (err) {
    throw new Error(`Failed to read/parse JSON from ${filePath}: ${err.message}`)
  }
}

function getFiles(dir, pattern) {
  const fullDir = path.resolve(rootDir, dir)
  if (!fs.existsSync(fullDir)) return []
  return fs
    .readdirSync(fullDir)
    .filter((file) => pattern.test(file))
    .map((file) => path.join(dir, file))
}

let hasError = false

function logSuccess(message) {
  console.log(`\x1b[32m✔\x1b[0m ${message}`)
}

function logError(message) {
  console.error(`\x1b[31m✖\x1b[0m ${message}`)
  hasError = true
}

// 1. Validate JSON Schemas
console.log('\nValidating JSON schemas...')
const schemaFiles = getFiles('schemas', /\.schema\.json$/)
const compiledSchemas = new Map()

for (const schemaFile of schemaFiles) {
  try {
    const schemaContent = readJsonFile(schemaFile)
    const validate = ajv.compile(schemaContent)
    compiledSchemas.set(schemaFile, validate)
    logSuccess(`Schema is valid: ${schemaFile}`)
  } catch (err) {
    logError(`Invalid schema in ${schemaFile}: ${err.message}`)
  }
}

// Provider rules that JSON Schema cannot express
function checkProvider(provider) {
  const errors = []
  const plans = provider.pricing?.plans ?? []
  const needsCurrency = (value) => value?.amount > 0
  const features = [...provider.features, ...(provider.oidc?.features ?? [])]
  if (
    !provider.pricing?.currency &&
    (plans.some(needsCurrency) || features.some((feature) => needsCurrency(feature.addOn)))
  ) {
    errors.push('/pricing/currency: required when a plan or add-on has a non-zero amount')
  }

  const planNames = new Set()
  for (const plan of plans) {
    if (planNames.has(plan.name)) errors.push(`/pricing/plans/${plan.name}: duplicate plan name`)
    planNames.add(plan.name)
    errors.push(...validateRates(plan.usage?.rates, `/pricing/plans/${plan.name}/usage/rates`))
  }

  const seen = new Set()
  for (const feature of features) {
    if (seen.has(feature.identifier)) errors.push(`/features/${feature.identifier}: duplicate feature`)
    seen.add(feature.identifier)
    const listed = [
      ...(feature.plans ?? []).map((name) => ['plans', name]),
      ...(feature.addOn?.plans ?? []).map((name) => ['addOn/plans', name]),
    ]
    for (const [field, planName] of listed) {
      if (!planNames.has(planName)) {
        errors.push(`/features/${feature.identifier}/${field}: "${planName}" is not a plan in pricing.plans`)
      }
    }
    for (const planName of Object.keys(feature.addOn?.included ?? {})) {
      if (!planNames.has(planName)) {
        errors.push(`/features/${feature.identifier}/addOn/included: "${planName}" is not a plan in pricing.plans`)
      }
    }
    errors.push(...validateRates(feature.addOn?.rates, `/features/${feature.identifier}/addOn/rates`))
  }
  return errors
}

function validateRates(rates, path) {
  const errors = []
  let previous = 0
  for (const rate of rates ?? []) {
    if (rate.upTo !== undefined && rate.upTo <= previous) {
      errors.push(`${path}: upTo must be in ascending order`)
    }
    previous = rate.upTo ?? Infinity
  }
  if (rates?.slice(0, -1).some((rate) => rate.upTo === undefined)) {
    errors.push(`${path}: only the last rate can omit upTo`)
  }
  return errors
}

// Validation mapping configuration
const validationTargets = [
  {
    name: 'Providers',
    schemaFile: 'schemas/provider.schema.json',
    files: getFiles('providers', /\.json$/),
    check: checkProvider,
  },
  {
    name: 'Categories definitions',
    schemaFile: 'schemas/categories.schema.json',
    files: getFiles('definitions', /-categories\.json$/),
  },
  {
    name: 'Features definitions',
    schemaFile: 'schemas/features.schema.json',
    files: getFiles('definitions', /-features\.json$/),
  },
  {
    name: 'Statuses definitions',
    schemaFile: 'schemas/statuses.schema.json',
    files: ['definitions/statuses.json'].filter((f) => fs.existsSync(path.resolve(rootDir, f))),
  },
  {
    name: 'Tiers definitions',
    schemaFile: 'schemas/tiers.schema.json',
    files: ['definitions/tiers.json'].filter((f) => fs.existsSync(path.resolve(rootDir, f))),
  },
]

for (const target of validationTargets) {
  console.log(`\nValidating ${target.name}...`)
  const validate = compiledSchemas.get(target.schemaFile)

  if (!validate) {
    logError(`Schema ${target.schemaFile} was not successfully compiled`)
    continue
  }

  for (const file of target.files) {
    try {
      const data = readJsonFile(file)
      const valid = validate(data)
      const extraErrors = target.check ? target.check(data) : []
      if (valid && extraErrors.length === 0) {
        logSuccess(`Valid: ${file}`)
      } else if (valid) {
        logError(`Validation failed for ${file}:`)
        for (const message of extraErrors) console.error(`  - ${message}`)
      } else {
        logError(`Validation failed for ${file}:`)
        for (const error of validate.errors || []) {
          console.error(`  - ${error.instancePath || '/'}: ${error.message} (${JSON.stringify(error.params)})`)
        }
        for (const message of extraErrors) console.error(`  - ${message}`)
      }
    } catch (err) {
      logError(err.message)
    }
  }
}

// Validate i18n and other JSON files syntax
console.log('\nValidating JSON syntax for remaining files...')
const otherFiles = [...getFiles('i18n', /\.json$/), 'renovate.json', '.prettierrc.json'].filter((f) =>
  fs.existsSync(path.resolve(rootDir, f)),
)

for (const file of otherFiles) {
  try {
    readJsonFile(file)
    logSuccess(`Valid JSON syntax: ${file}`)
  } catch (err) {
    logError(err.message)
  }
}

if (hasError) {
  console.error('\n\x1b[31mJSON validation failed.\x1b[0m\n')
  process.exit(1)
} else {
  console.log('\n\x1b[32mAll JSON files and schemas are valid!\x1b[0m\n')
  process.exit(0)
}
