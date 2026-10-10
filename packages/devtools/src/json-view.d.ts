declare module '@pgrabovets/json-view' {
  interface JsonTreeNode {
    key: string | null;
    children: JsonTreeNode[];
    el: HTMLElement | null;
    isExpanded: boolean;
    depth: number;
  }
  const jsonview: {
    create(value: string): JsonTreeNode;
    render(tree: JsonTreeNode, container: HTMLElement): void;
    destroy(tree: JsonTreeNode): void;
    expand(tree: JsonTreeNode): void;
    collapse(tree: JsonTreeNode): void;
    toggleNode(tree: JsonTreeNode): void;
    traverse(tree: JsonTreeNode, visit: (node: JsonTreeNode) => void): void;
  };
  export default jsonview;
}
