const prisma = require('../config/db');

// GET /api/budgets - List budgets
const getBudgets = async (req, res) => {
  try {
    const { department_id, fiscal_year, status, page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};
    if (department_id) where.department_id = department_id;
    if (fiscal_year) where.fiscal_year = parseInt(fiscal_year);
    if (status) where.status = status;

    const [budgets, total] = await Promise.all([
      prisma.budget.findMany({
        where,
        include: {
          department: { select: { id: true, name: true, shortcode: true } },
        },
        orderBy: [
          { fiscal_year: 'desc' },
          { department_id: 'asc' },
        ],
        skip,
        take: parseInt(limit),
      }),
      prisma.budget.count({ where }),
    ]);

    res.json({
      budgets,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// GET /api/budgets/:id - Get budget by ID
const getBudgetById = async (req, res) => {
  try {
    const budget = await prisma.budget.findUnique({
      where: { id: req.params.id },
      include: {
        department: true,
      },
    });

    if (!budget) return res.status(404).json({ error: 'Budget not found' });

    res.json(budget);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// POST /api/budgets - Create budget
const createBudget = async (req, res) => {
  try {
    const { department_id, fiscal_year, category, allocated_amount, notes } = req.body;

    if (!department_id || !fiscal_year || !allocated_amount) {
      return res.status(400).json({ error: 'Department ID, fiscal year, and allocated amount are required' });
    }

    const remainingAmount = parseFloat(allocated_amount);

    const budget = await prisma.budget.create({
      data: {
        department_id,
        fiscal_year: parseInt(fiscal_year),
        category,
        allocated_amount: parseFloat(allocated_amount),
        spent_amount: 0,
        remaining_amount,
        status: 'ACTIVE',
        notes,
      },
      include: {
        department: { select: { name: true } },
      },
    });

    res.status(201).json(budget);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// PATCH /api/budgets/:id - Update budget
const updateBudget = async (req, res) => {
  try {
    const { allocated_amount, category, status, notes } = req.body;

    const budget = await prisma.budget.findUnique({
      where: { id: req.params.id },
    });

    if (!budget) return res.status(404).json({ error: 'Budget not found' });

    const data = {};
    if (allocated_amount) {
      data.allocated_amount = parseFloat(allocated_amount);
      data.remaining_amount = parseFloat(allocated_amount) - budget.spent_amount;
    }
    if (category !== undefined) data.category = category;
    if (status) data.status = status;
    if (notes !== undefined) data.notes = notes;

    const updated = await prisma.budget.update({
      where: { id: req.params.id },
      data,
      include: {
        department: { select: { name: true } },
      },
    });

    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// POST /api/budgets/:id/expenditure - Record expenditure
const recordExpenditure = async (req, res) => {
  try {
    const { amount, notes } = req.body;

    if (!amount) {
      return res.status(400).json({ error: 'Amount is required' });
    }

    const budget = await prisma.budget.findUnique({
      where: { id: req.params.id },
    });

    if (!budget) return res.status(404).json({ error: 'Budget not found' });

    const expenditureAmount = parseFloat(amount);
    const newSpentAmount = budget.spent_amount + expenditureAmount;
    const newRemainingAmount = budget.remaining_amount - expenditureAmount;

    if (newRemainingAmount < 0) {
      return res.status(400).json({ error: 'Insufficient budget balance' });
    }

    const updated = await prisma.budget.update({
      where: { id: req.params.id },
      data: {
        spent_amount: newSpentAmount,
        remaining_amount: newRemainingAmount,
      },
      include: {
        department: { select: { name: true } },
      },
    });

    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// GET /api/budgets/summary - Get budget summary
const getBudgetSummary = async (req, res) => {
  try {
    const { fiscal_year } = req.query;
    const currentYear = fiscal_year ? parseInt(fiscal_year) : new Date().getFullYear();

    const budgets = await prisma.budget.findMany({
      where: { fiscal_year: currentYear },
      include: {
        department: { select: { name: true, shortcode: true } },
      },
    });

    const totalAllocated = budgets.reduce((sum, b) => sum + b.allocated_amount, 0);
    const totalSpent = budgets.reduce((sum, b) => sum + b.spent_amount, 0);
    const totalRemaining = budgets.reduce((sum, b) => sum + b.remaining_amount, 0);

    // Group by department
    const byDepartment = {};
    budgets.forEach(b => {
      const deptName = b.department.name;
      if (!byDepartment[deptName]) {
        byDepartment[deptName] = {
          allocated: 0,
          spent: 0,
          remaining: 0,
        };
      }
      byDepartment[deptName].allocated += b.allocated_amount;
      byDepartment[deptName].spent += b.spent_amount;
      byDepartment[deptName].remaining += b.remaining_amount;
    });

    res.json({
      fiscal_year: currentYear,
      total_allocated: totalAllocated,
      total_spent: totalSpent,
      total_remaining: totalRemaining,
      utilization_percentage: totalAllocated > 0 ? (totalSpent / totalAllocated) * 100 : 0,
      by_department: byDepartment,
      budgets,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// DELETE /api/budgets/:id - Delete budget
const deleteBudget = async (req, res) => {
  try {
    const budget = await prisma.budget.findUnique({
      where: { id: req.params.id },
    });

    if (!budget) return res.status(404).json({ error: 'Budget not found' });

    if (budget.spent_amount > 0) {
      return res.status(400).json({ error: 'Cannot delete budget with recorded expenditures' });
    }

    await prisma.budget.delete({ where: { id: req.params.id } });
    res.json({ message: 'Budget deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = {
  getBudgets,
  getBudgetById,
  createBudget,
  updateBudget,
  recordExpenditure,
  getBudgetSummary,
  deleteBudget,
};
