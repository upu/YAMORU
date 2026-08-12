"use client";

import {
  createContext,
  type ReactNode,
  useContext,
  useState,
} from "react";

import {
  CAT_WATER_FOUNTAIN,
  type Activity,
} from "./managed-items/cat-water-fountain/sample-data";
import {
  computeMaintenanceWindow,
  formatMonthDay,
  parseDateOnly,
} from "./task-schedule";

const SAMPLE_MEMBER = "家族A";

type DemoState = {
  isFilterReplacementCompleted: boolean;
  lastActivity: Activity;
  scheduledFor: Date;
  dueAt: Date;
  history: Activity[];
};

type DemoStateValue = DemoState & {
  completeFilterReplacement: (occurredAt: Date) => void;
};

const DemoStateContext = createContext<DemoStateValue | null>(null);

export function formatDateInput(date: Date) {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function createInitialState(): DemoState {
  const { scheduledFor, dueAt } = computeMaintenanceWindow(
    parseDateOnly(CAT_WATER_FOUNTAIN.lastActivity.dateTime),
  );

  return {
    isFilterReplacementCompleted: false,
    lastActivity: CAT_WATER_FOUNTAIN.lastActivity,
    scheduledFor,
    dueAt,
    history: [...CAT_WATER_FOUNTAIN.history],
  };
}

export function DemoStateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(createInitialState);

  function completeFilterReplacement(occurredAt: Date) {
    setState((current) => {
      if (current.isFilterReplacementCompleted) {
        return current;
      }

      const { scheduledFor, dueAt } = computeMaintenanceWindow(occurredAt);
      const activity = {
        date: formatMonthDay(occurredAt),
        dateTime: formatDateInput(occurredAt),
        member: SAMPLE_MEMBER,
      };

      return {
        isFilterReplacementCompleted: true,
        lastActivity: activity,
        scheduledFor,
        dueAt,
        history: [activity, ...current.history],
      };
    });
  }

  return (
    <DemoStateContext.Provider value={{ ...state, completeFilterReplacement }}>
      {children}
    </DemoStateContext.Provider>
  );
}

export function useDemoState() {
  const context = useContext(DemoStateContext);

  if (context === null) {
    throw new Error("useDemoState must be used within DemoStateProvider");
  }

  return context;
}
