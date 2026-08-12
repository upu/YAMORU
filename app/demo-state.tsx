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

const SAMPLE_MEMBER = "家族A";

type DemoState = {
  isFilterReplacementCompleted: boolean;
  lastActivity: Activity;
  nextDueDate: string;
  history: Activity[];
};

type DemoStateValue = DemoState & {
  completeFilterReplacement: (occurredAt: Date) => void;
};

const DemoStateContext = createContext<DemoStateValue | null>(null);

function formatDate(date: Date) {
  return `${String(date.getMonth() + 1)}月${String(date.getDate())}日`;
}

function formatDueDate(date: Date) {
  return `${String(date.getMonth() + 1)}月${String(date.getDate())}日まで`;
}

export function formatDateInput(date: Date) {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function createInitialState(): DemoState {
  return {
    isFilterReplacementCompleted: false,
    lastActivity: CAT_WATER_FOUNTAIN.lastActivity,
    nextDueDate: CAT_WATER_FOUNTAIN.nextDueDate,
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

      const nextDueAt = new Date(occurredAt);
      nextDueAt.setDate(nextDueAt.getDate() + 30);
      const activity = {
        date: formatDate(occurredAt),
        dateTime: formatDateInput(occurredAt),
        member: SAMPLE_MEMBER,
      };

      return {
        isFilterReplacementCompleted: true,
        lastActivity: activity,
        nextDueDate: formatDueDate(nextDueAt),
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
