import { InputAlias, Workflows } from "../definitions"
import {
  TransactionStepsDefinition,
  WorkflowManager,
} from "@medusajs/orchestration"
import {
  createProducts as createProductsHandler,
  removeProducts,
} from "../functions"
import { exportWorkflow, pipe } from "../helper"
import { ProductTypes } from "@medusajs/types"

enum Actions {
  createProduct = "createProduct",
}

const workflowSteps: TransactionStepsDefinition = {
  next: {
    action: Actions.createProduct,
  },
}

const handlers = new Map([
  [
    Actions.createProduct,
    {
      invoke: pipe(
        {
          inputAlias: InputAlias.Products,
          invoke: {
            from: InputAlias.Products,
            alias: InputAlias.Products,
          },
        },
        createProductsHandler
      ),
      compensate: pipe(
        {
          invoke: {
            from: Actions.createProduct,
            alias: InputAlias.Products,
          },
        },
        removeProducts
      ),
    },
  ],
])

WorkflowManager.register(Workflows.CreateProducts, workflowSteps, handlers)

export const createProducts = exportWorkflow<ProductTypes.CreateProductDTO>(
  Workflows.CreateProducts,
  Actions.createProduct
)