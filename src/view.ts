import { TextFileView, ButtonComponent, Notice, DropdownComponent, getIcon, IconName } from "obsidian";
import { CSVUtils, CSVParseConfig } from './utils/csv-utils';
import { TableHistoryManager } from './utils/history-manager';
import { TableUtils } from './utils/table-utils';
import { i18n } from './i18n'; // 修正导入路径

export const VIEW_TYPE_CSV = "csv-view";

export class CSVView extends TextFileView {
  tableData: string[][];
  tableEl: HTMLElement;
  operationEl: HTMLElement;
  
  // 使用新的历史记录管理器
  private historyManager: TableHistoryManager;
  private maxHistorySize: number = 50;

  // 列宽调整设置
  private columnWidths: number[] = [];
  private autoResize: boolean = true;
  
  // Papa Parse 配置选项
  private papaConfig: CSVParseConfig = {
    header: false,
    dynamicTyping: false,
    skipEmptyLines: false
  };

  // 编辑栏
  private editBarEl: HTMLElement;
  private editInput: HTMLInputElement;
  private activeCellEl: HTMLInputElement | null = null;
  private activeRowIndex: number = -1;
  private activeColIndex: number = -1;

  constructor(leaf: any) {
    super(leaf);
    this.historyManager = new TableHistoryManager(undefined, this.maxHistorySize);
  }

getIcon(): IconName {
	return "table";
}
  getViewData() {
    return CSVUtils.unparseCSV(this.tableData);
  }

  setViewData(data: string, clear: boolean) {
    try {
      // 使用工具类解析CSV数据
      this.tableData = CSVUtils.parseCSV(data, this.papaConfig);
      
      // 确保至少有一行一列
      if (!this.tableData || this.tableData.length === 0) {
        this.tableData = [[""]];
      }
      
      // 使所有行的列数一致
      this.tableData = CSVUtils.normalizeTableData(this.tableData);
      
      // 初始化历史记录
      if (clear) {
        this.historyManager.reset(this.tableData);
      }
      
      this.refresh();
    } catch (error) {
      console.error("CSV处理错误:", error);
      
      // 出错时设置为空表格
      this.tableData = [[""]];
      if (clear) {
        this.historyManager.reset(this.tableData);
      }
      this.refresh();
    }
  }

  refresh() {
    this.tableEl.empty();
    
    // 创建表头行用于调整列宽
    const headerRow = this.tableEl.createEl("thead").createEl("tr");
    
    // 计算初始列宽（如果未设置）
    if (this.columnWidths.length === 0 && this.tableData[0]) {
      this.columnWidths = TableUtils.calculateColumnWidths(this.tableData);
    }
    
    // 创建表头和调整列宽的手柄
    if (this.tableData[0]) {
      this.tableData[0].forEach((headerCell, index) => {
        const th = headerRow.createEl("th", { 
          cls: "csv-th",
          attr: { 
            style: `width: ${this.columnWidths[index] || 100}px;`
          }
        });
        
        // 添加列标题
        const headerInput = th.createEl("input", { 
          cls: "csv-cell-input",
          attr: { value: headerCell }
        });
        
        // 列标题内容变更时的处理
        headerInput.oninput = (ev) => {
          if (ev.currentTarget instanceof HTMLInputElement) {
            if (this.tableData[0][index] !== ev.currentTarget.value) {
              this.saveSnapshot();
            }
            this.tableData[0][index] = ev.currentTarget.value;
            this.requestSave();
          }
        };
        
        // 为表头输入框添加聚焦事件
        headerInput.onfocus = (ev) => {
          this.setActiveCell(0, index, ev.currentTarget as HTMLInputElement);
        };
        
        // 添加调整列宽的手柄
        const resizeHandle = th.createEl("div", { cls: "resize-handle" });
        
        // 实现列宽调整
        this.setupColumnResize(resizeHandle, index);
      });
    }
    
    // 创建表格主体
    const tableBody = this.tableEl.createEl("tbody");

    // 从第二行开始显示数据行（如果有表头）
    const startRowIndex = this.tableData.length > 1 ? 1 : 0;
    
    for (let i = startRowIndex; i < this.tableData.length; i++) {
      const row = this.tableData[i];
      const tableRow = tableBody.createEl("tr");
      
      row.forEach((cell, j) => {
        const td = tableRow.createEl("td", {
          attr: {
            style: `width: ${this.columnWidths[j] || 100}px;`
          }
        });
        
        const input = td.createEl("input", { 
          cls: "csv-cell-input",
          attr: { 
            value: cell,
            style: "min-height: 24px;" 
          }
        });
        
        // 为输入框添加自动调整高度的功能
        this.setupAutoResize(input);
        
        input.oninput = (ev) => {
          if (ev.currentTarget instanceof HTMLInputElement) {
            // 保存历史状态（仅在第一次修改时保存）
            if (this.tableData[i][j] !== ev.currentTarget.value) {
              this.saveSnapshot();
            }
            
            this.tableData[i][j] = ev.currentTarget.value;
            
            // 如果是当前活动单元格，同步到编辑栏
            if (this.activeCellEl === ev.currentTarget && this.editInput) {
              this.editInput.value = ev.currentTarget.value;
            }
            
            this.requestSave();
            
            // 自动调整输入框高度
            if (this.autoResize) {
              this.adjustInputHeight(ev.currentTarget);
            }
          }
        };
        
        // 为单元格输入框添加聚焦事件
        input.onfocus = (ev) => {
          this.setActiveCell(i, j, ev.currentTarget as HTMLInputElement);
        };
      });
    }
  }
  
  // 设置活动单元格
  private setActiveCell(rowIndex: number, colIndex: number, cellEl: HTMLInputElement) {
    // 移除之前单元格的高亮
    if (this.activeCellEl && this.activeCellEl.parentElement) {
      this.activeCellEl.parentElement.removeClass('csv-active-cell');
    }
    
    // 设置新的活动单元格
    this.activeRowIndex = rowIndex;
    this.activeColIndex = colIndex;
    this.activeCellEl = cellEl;
    
    // 高亮当前单元格
    if (cellEl.parentElement) {
      cellEl.parentElement.addClass('csv-active-cell');
    }
    
    // 更新编辑栏内容
    if (this.editInput) {
      this.editInput.value = cellEl.value;
      
      // 更新编辑栏的地址显示
      const cellAddress = TableUtils.getCellAddress(rowIndex, colIndex);
      this.editBarEl.setAttribute('data-cell-address', cellAddress);
    }
  }

  // 设置列宽调整功能
  private setupColumnResize(handle: HTMLElement, columnIndex: number) {
    let startX: number;
    let startWidth: number;
    
    const onMouseDown = (e: MouseEvent) => {
      startX = e.clientX;
      startWidth = this.columnWidths[columnIndex] || 100;
      
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      
      e.preventDefault();
    };
    
    const onMouseMove = (e: MouseEvent) => {
      const width = startWidth + (e.clientX - startX);
      if (width >= 50) { // 最小宽度限制
        this.columnWidths[columnIndex] = width;
        this.refresh();
      }
    };
    
    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    
    handle.addEventListener('mousedown', onMouseDown);
  }
  
  // 设置输入框自动调整高度
  private setupAutoResize(input: HTMLInputElement) {
    // 初始调整
    this.adjustInputHeight(input);
    
    // 监听内容变化
    input.addEventListener('input', () => {
      if (this.autoResize) {
        this.adjustInputHeight(input);
      }
    });
  }
  
  // 调整输入框高度
  private adjustInputHeight(input: HTMLInputElement) {
    input.style.height = 'auto';
    
    // 获取内容行数
    const lineCount = (input.value.match(/\n/g) || []).length + 1;
    const minHeight = 24; // 最小高度
    const lineHeight = 20; // 每行高度
    
    // 设置高度，确保能显示所有内容
    const newHeight = Math.max(minHeight, lineCount * lineHeight);
    input.style.height = `${newHeight}px`;
  }

  // 保存当前状态到历史记录
  private saveSnapshot() {
    this.historyManager.push(this.tableData);
  }

  // 执行撤销操作
  undo() {
    const prevState = this.historyManager.undo();
    if (prevState) {
      this.tableData = prevState;
      this.refresh();
      this.requestSave();
    }
  }
  
  // 执行重做操作
  redo() {
    const nextState = this.historyManager.redo();
    if (nextState) {
      this.tableData = nextState;
      this.refresh();
      this.requestSave();
    }
  }

  clear() {
    this.tableData = [[""]];
    this.historyManager.reset(this.tableData);
    this.refresh();
  }

  getViewType() {
    return VIEW_TYPE_CSV;
  }

  async onOpen() {
    // 创建操作区
    this.operationEl = this.contentEl.createEl("div", { cls: "csv-operations" });
    
    // 创建操作按钮容器
    const buttonContainer = this.operationEl.createEl("div", { cls: "csv-operation-buttons" });
    
    // 撤销按钮
    new ButtonComponent(buttonContainer)
      .setButtonText(i18n.t('buttons.undo'))
      .setIcon("undo")
      .onClick(() => this.undo());
      
    // 重做按钮
    new ButtonComponent(buttonContainer)
      .setButtonText(i18n.t('buttons.redo'))
      .setIcon("redo")
      .onClick(() => this.redo());
    
    // 添加行按钮
    new ButtonComponent(buttonContainer)
      .setButtonText(i18n.t('buttons.addRow'))
      .onClick(() => this.addRow());
    
    // 删除行按钮
    new ButtonComponent(buttonContainer)
      .setButtonText(i18n.t('buttons.deleteRow'))
      .onClick(() => this.deleteRow());
    
    // 添加列按钮
    new ButtonComponent(buttonContainer)
      .setButtonText(i18n.t('buttons.addColumn'))
      .onClick(() => this.addColumn());
    
    // 删除列按钮
    new ButtonComponent(buttonContainer)
      .setButtonText(i18n.t('buttons.deleteColumn'))
      .onClick(() => this.deleteColumn());
    
    // 重置列宽按钮
    new ButtonComponent(buttonContainer)
      .setButtonText(i18n.t('buttons.resetColumnWidth'))
      .onClick(() => {
        this.columnWidths = [];
        this.calculateColumnWidths();
        this.refresh();
      });
    
    // CSV导入导出选项
    const exportImportContainer = this.operationEl.createEl("div", { cls: "csv-export-import" });

    
    // 创建编辑栏（在操作区之后）
    this.editBarEl = this.contentEl.createEl("div", { cls: "csv-edit-bar" });
    
    // 创建编辑输入框
    this.editInput = this.editBarEl.createEl("input", { 
      cls: "csv-edit-input",
      attr: { placeholder: i18n.t('editBar.placeholder') }
    });
    
    // 添加编辑栏输入处理
    this.editInput.oninput = () => {
      if (this.activeCellEl && this.activeRowIndex >= 0 && this.activeColIndex >= 0) {
        // 更新活动单元格
        this.activeCellEl.value = this.editInput.value;
        
        // 更新数据
        if (this.tableData[this.activeRowIndex][this.activeColIndex] !== this.editInput.value) {
          this.saveSnapshot();
        }
        this.tableData[this.activeRowIndex][this.activeColIndex] = this.editInput.value;
        this.requestSave();
      }
    };
    
    // 创建表格区域
    this.tableEl = this.contentEl.createEl("table");
    
    // 初始化历史记录
    if (!this.historyManager) {
      this.historyManager = new TableHistoryManager(this.tableData, this.maxHistorySize);
    }
    
    // 添加键盘事件监听器
    this.registerDomEvent(document, 'keydown', (event: KeyboardEvent) => {
      // 检测Ctrl+Z (或Mac上的Cmd+Z)
      if ((event.ctrlKey || event.metaKey) && event.key === 'z') {
        if (event.shiftKey) {
          // Ctrl+Shift+Z 或 Cmd+Shift+Z 重做
          event.preventDefault();
          this.redo();
        } else {
          // Ctrl+Z 或 Cmd+Z 撤销
          event.preventDefault();
          this.undo();
        }
      }
    });
    
    // 初始化时刷新视图
    this.refresh();
    
    // 添加样式
    // this.addStyles();
  }

  // 需要添加calculateColumnWidths方法
  private calculateColumnWidths() {
    this.columnWidths = TableUtils.calculateColumnWidths(this.tableData);
  }

  async onClose() {
    // 移除自定义样式
    const styleEl = document.head.querySelector('#csv-edit-bar-styles');
    if (styleEl) styleEl.remove();
    
    this.contentEl.empty();
  }
  
  // 表格操作方法
  addRow() {
    this.saveSnapshot();
    this.tableData = TableUtils.addRow(this.tableData);
    this.refresh();
    this.requestSave();
  }
  
  deleteRow() {
    this.saveSnapshot();
    this.tableData = TableUtils.deleteRow(this.tableData);
    this.refresh();
    this.requestSave();
  }
  
  addColumn() {
    this.saveSnapshot();
    this.tableData = TableUtils.addColumn(this.tableData);
    this.refresh();
    this.requestSave();
  }
  
  deleteColumn() {
    this.saveSnapshot();
    this.tableData = TableUtils.deleteColumn(this.tableData);
    this.refresh();
    this.requestSave();
  }
}
