import React from 'react';
import { render, screen } from '@testing-library/react';
import { CustomMenu, CustomMenuItem } from '../CustomMenu';

/* eslint-disable i18next/no-literal-string -- The labels are component-test fixtures. */

it('renders menu actions outside the searchable listbox', async () => {
  render(
    <CustomMenu
      defaultOpen
      label="OpenAI"
      searchValue=""
      onSearch={() => {}}
      combobox={<input aria-label="Search OpenAI models" placeholder=" " />}
      groupLabel="OpenAI actions"
      trailingAction={
        <CustomMenuItem
          hideOnClick={false}
          render={<button type="button">Configure OpenAI</button>}
        />
      }
    >
      <CustomMenuItem>GPT model</CustomMenuItem>
    </CustomMenu>,
  );

  const configureButton = await screen.findByRole('menuitem', { name: 'Configure OpenAI' });

  expect(configureButton.closest('[role="listbox"]')).toBeNull();
  expect(configureButton.closest('[role="option"]')).toBeNull();
  expect(screen.getByRole('group', { name: 'OpenAI actions' })).toContainElement(configureButton);
});
