---
id: grids-forms
title: Forms
icon: ti ti-forms
description: Build focused and validated record-entry flows.
order: 130
---
Forms simplify how people add records to a base. They keep labels, guidance, required inputs, defaults, and relation handling in one reusable entry flow.

Forms do not replace tables. They validate and write records into one table. Use a Custom App when a task needs several pages, data, instructions, and actions around one or more Forms.

## Create a focused form {icon="forms"}

Every table has a virtual default form based on its fields. Create a custom form when users need different labels, help text, required inputs, defaults, a smaller field set, or a controlled public link.

In a custom form you can:

- choose the title, description, title image, submit label, and success message;
- arrange user inputs and explain what each answer means;
- apply hidden values that the person submitting cannot change, such as a fixed request status;
- allow configured relation fields to create related records inline;
- redirect after a successful submission;
- pause submissions without deleting the form.

A signed-in user can submit with **Write/Use** access to the form or inherited table write access. They do not need permission to browse the table when the form itself grants use.

Turn on **Public form** only when anonymous submissions are intended. The unique public URL accepts only the form's configured fields and always applies its hidden values. Turning public access off invalidates the existing link; enabling it again creates a new one.

Test a form with incomplete and invalid input before sharing it. Confirm that required fields, relation creation, success text, and redirect behavior are understandable without knowledge of the table.

## Reuse a Form in a Custom App {icon="app-window"}

A Custom App may render an existing active Form as one block. The Form keeps ownership of its inputs and validation. The app may add fixed relation values from declared page parameters and navigate to another page after a successful submission.

Use this composition when people need context before entering data, a repeated “add another” flow, or a detail page after creation. Keep the Form useful on its own and put multi-page navigation in the Custom App.

Form access is still checked when the app renders or submits it. App access does not turn an inactive or inaccessible Form into a writable endpoint.
