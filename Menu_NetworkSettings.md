13. All numeric option lists in the JSON will be sorted low to high for consistency in the UI.
# Network Settings Menu (Text Description)

This section is for describing the menu system as seen in the actual product images. Please edit below to match the real product:

---

## Menu Layout

1. ---The Title shows the words 'communcation settings' at the top two lines, center aligned

2.1 This screen uses all one font

2.2 This menu has two columns, one for text on the left and one for value on the right. 

2.3 There are three rows in the table. 

2. 4 The text for each row is left aligned starting at the very left of the diplay. No padding. The first char of each text entry shall all align at the far left of the screen. 

3. The value for each item is shown to the right of the title column. The value is surrounded by a rounded box of 6 chars, left aligned. 

4. At the bottom is a navigation menu with Unicode left, right, up, and down arrow symbols. The up and down arrows are bold and slightly larger for emphasis. Each arrow is separated by one character of padding for even spacing across the bottom of the screen. 

5. The text for the threee menus items is Modbus, Baud and Mode, with Modbus on the top, Baud in the middle and Mode on the bottom. 


6. The default values are 133, 115200, and MODBUS


7 All text in this simulation is rendered bold to match the product photos. It is a monospaced font. 


8. During debugging, the simulator auto tester can be toggled on/off from the debug panel. When enabled, it:
  - Simulates a right arrow keypress to move focus to the next menu item, waits 3 seconds, then advances.
  - Simulates an up arrow keypress to increment the value of the focused item (focus does not change on up/down).
  - Waits 3 seconds, then repeats.

9. For debugging, a light grey grid overlay should be shown on the display, marking each character position (ch) horizontally and row position vertically. This helps verify that all menu items are perfectly aligned to the character grid.

9.2 There are 10 rows and 17 chars, estimated. Check the source code to confirm. 

9.1 All rows in the grid overlay must be the same height and all columns must be the same width, matching a uniform character cell layout.

10. The label text width and value box width are now configurable via the JSON file using the associated parameters 

11. To the left of the Tstat10 is a debug panel. It now includes toggles for: Grid, Coords, Redbox and Auto Tester. The panel also shows live Event, Focus, Value, and Redbox coordinates. All items use a consistent monospaced font and are visually aligned.


12. There is a redbox overlay to highlight a specific cell in the LCD grid. Its coordinates are shown in the debug panel. 

12.1 The Redbox checkbox toggles the highlight on/off. 

12.2 The keypad can be used to move the redbox around using standrd WASD iteractions. 
             as the redbox moves around the coords update
