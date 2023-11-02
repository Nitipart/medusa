import {
  CalculatedPriceSetDTO,
  Context,
  PricingContext,
  PricingFilters,
} from "@medusajs/types"
import { MedusaError, MikroOrmBase } from "@medusajs/utils"
import { SqlEntityManager } from "@mikro-orm/postgresql"
import { PricingRepositoryService } from "../types"

export class PricingRepository
  extends MikroOrmBase
  implements PricingRepositoryService
{
  protected readonly manager_: SqlEntityManager

  constructor({ manager }: { manager: SqlEntityManager }) {
    // @ts-ignore
    // eslint-disable-next-line prefer-rest-params
    super(...arguments)

    this.manager_ = manager
  }

  async calculatePrices(
    pricingFilters: PricingFilters,
    pricingContext: PricingContext = { context: {} },
    sharedContext: Context = {}
  ): Promise<CalculatedPriceSetDTO[]> {
    const manager = this.getActiveManager<SqlEntityManager>()
    const knex = manager.getKnex()
    const context = pricingContext.context || {}

    // Quantity is used to scope money amounts based on min_quantity and max_quantity.
    // We should potentially think of reserved words in pricingContext that can't be used in rules
    // or have a separate pricing options that accept things like quantity, price_list_id and other
    // pricing module features
    const quantity = context.quantity
    delete context.quantity

    // Currency code here is a required param.
    const currencyCode = context.currency_code
    delete context.currency_code

    if (!currencyCode) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Method calculatePrices requires currency_code in the pricing context`
      )
    }

    const isContextPresent = Object.entries(context).length || !!currencyCode

    // Only if the context is present do we need to query the database.
    // We don't get anything from the db otherwise.
    if (!isContextPresent) {
      return []
    }

    // Gets all the price set money amounts where rules match for each of the contexts
    // that the price set is configured for
    const psmaSubQueryKnex = knex({
      psma: "price_set_money_amount",
    })
      .select({
        id: "psma1.id",
        price_set_id: "psma1.price_set_id",
        money_amount_id: "psma1.money_amount_id",
        number_rules: "psma1.number_rules",
        price_list_id: "psma1.price_list_id",
        pl_number_rules: "pl.number_rules",
      })
      .leftJoin("price_set_money_amount as psma1", "psma1.id", "psma1.id")
      .leftJoin("price_rule as pr", "pr.price_set_money_amount_id", "psma1.id")
      .leftJoin("price_list as pl", "pl.id", "psma1.price_list_id")
      .leftJoin("price_list_rule as plr", "plr.price_list_id", "pl.id")
      .leftJoin(
        "price_list_rule_value as plrv",
        "plrv.price_list_rule_id",
        "plr.id"
      )
      .leftJoin("rule_type as plrt", "plrt.id", "plr.rule_type_id")
      .leftJoin("rule_type as rt", "rt.id", "pr.rule_type_id")
      .orderBy("pl.number_rules", "desc")
      .orderBy("number_rules", "desc")
      .orderBy([
        { column: "number_rules", order: "desc" },
        { column: "pl.number_rules", order: "desc" },
      ])
      .groupBy("psma1.id", "pl.id")
      .having(
        knex.raw(
          "count(DISTINCT rt.rule_attribute) = psma1.number_rules AND psma1.price_list_id IS NULL"
        )
      )
      .orHaving(
        knex.raw(
          "count(DISTINCT plrt.rule_attribute) = pl.number_rules AND psma1.price_list_id IS NOT NULL"
        )
      )

    psmaSubQueryKnex.orWhere((q) => {
      for (const [key, value] of Object.entries(context)) {
        q.orWhere({
          "rt.rule_attribute": key,
          "pr.value": value,
        })
      }

      q.orWhere("psma1.number_rules", "=", 0)
      q.whereNull("psma1.price_list_id")
    })

    psmaSubQueryKnex.orWhere((q) => {
      for (const [key, value] of Object.entries(context)) {
        q.orWhere({
          "plrt.rule_attribute": key,
        })
        q.whereIn("plrv.value", [value])
      }

      q.orWhere("pl.number_rules", "=", 0)
      q.whereNotNull("psma1.price_list_id")
    })

    const priceSetQueryKnex = knex({
      ps: "price_set",
    })
      .select({
        id: "ps.id",
        amount: "ma.amount",
        min_quantity: "ma.min_quantity",
        max_quantity: "ma.max_quantity",
        currency_code: "ma.currency_code",
        default_priority: "rt.default_priority",
        number_rules: "psma.number_rules",
        pl_number_rules: "psma.pl_number_rules",
        price_list_id: "psma.price_list_id",
      })
      .join(psmaSubQueryKnex.as("psma"), "psma.price_set_id", "ps.id")
      .join("money_amount as ma", "ma.id", "psma.money_amount_id")
      .leftJoin("price_rule as pr", "pr.price_set_money_amount_id", "psma.id")
      .leftJoin("rule_type as rt", "rt.id", "pr.rule_type_id")
      .whereIn("ps.id", pricingFilters.id)
      .andWhere("ma.currency_code", "=", currencyCode)
      .orderBy([
        { column: "price_list_id", order: "asc" },
        { column: "number_rules", order: "desc" },
        { column: "default_priority", order: "desc" },
      ])

    if (quantity) {
      priceSetQueryKnex.where("ma.min_quantity", "<=", quantity)
      priceSetQueryKnex.andWhere("ma.max_quantity", ">=", quantity)
    }

    return await priceSetQueryKnex
  }
}
